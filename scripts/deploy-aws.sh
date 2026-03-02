#!/usr/bin/env bash
# scripts/deploy-aws.sh — Deploy 1111 School to AWS App Runner + RDS PostgreSQL
#
# Usage:
#   ./scripts/deploy-aws.sh
#
# Required (prompted if unset):
#   ANTHROPIC_API_KEY   — auto-read from backend/.env, else prompted
#   DB_PASSWORD         — RDS master password (min 8 chars)
#   JWT_SECRET          — auto-generated if unset (save the output!)
#
# Optional:
#   APP_NAME            — resource name prefix          (default: 1111-school)
#   AWS_REGION          — target region                 (default: us-east-1)
#   AWS_PROFILE         — AWS CLI profile
#   DB_USER             — RDS master username           (default: learnapp)
#   DB_NAME             — RDS database name             (default: learn)
#   DB_INSTANCE_CLASS   — RDS instance size             (default: db.t4g.micro)
#   IMAGE_TAG           — Docker image tag              (default: git SHA)
#   APP_RUNNER_CPU      — 256|512|1024|2048|4096        (default: 1024)
#   APP_RUNNER_MEMORY   — 512|1024|2048|3072|4096 (MB) (default: 2048)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TMPDIR_LOCAL="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_LOCAL"' EXIT

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${BLUE}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $*"; }
die()   { echo -e "\n${RED}✗ ERROR:${NC} $*\n" >&2; exit 1; }
phase() { echo -e "\n${BOLD}── $* ──────────────────────────────────────────${NC}"; }

# ── Configuration ─────────────────────────────────────────────────────────────
APP_NAME="${APP_NAME:-1111-school}"
AWS_REGION="${AWS_REGION:-us-east-1}"
DB_NAME="${DB_NAME:-learn}"
DB_USER="${DB_USER:-learnapp}"
DB_INSTANCE_CLASS="${DB_INSTANCE_CLASS:-db.t4g.micro}"
APP_PORT=8000
APP_RUNNER_CPU="${APP_RUNNER_CPU:-1024}"
APP_RUNNER_MEMORY="${APP_RUNNER_MEMORY:-2048}"

# Derived resource names
ECR_REPO="${APP_NAME}"
RDS_ID="db-${APP_NAME}"
RDS_SUBNET_GRP="db-${APP_NAME}-subnet-grp"
SG_APPRUNNER="${APP_NAME}-ar-sg"
SG_RDS="${APP_NAME}-rds-sg"
VPC_CONNECTOR="${APP_NAME}-vpc-conn"
AR_SERVICE="${APP_NAME}"
IAM_ROLE="${APP_NAME}-ar-ecr-role"

# Image tag: git short SHA, or 'latest'
if git -C "$ROOT_DIR" rev-parse --short HEAD &>/dev/null 2>&1; then
    IMAGE_TAG="${IMAGE_TAG:-$(git -C "$ROOT_DIR" rev-parse --short HEAD)}"
else
    IMAGE_TAG="${IMAGE_TAG:-latest}"
fi

# ── Preflight ─────────────────────────────────────────────────────────────────
preflight() {
    phase "Preflight"
    for cmd in aws docker jq openssl; do
        command -v "$cmd" &>/dev/null || die "'$cmd' is required but not installed"
    done
    aws sts get-caller-identity &>/dev/null || \
        die "AWS credentials not configured — run 'aws configure' or set AWS_PROFILE"
    ok "Prerequisites OK (aws, docker, jq, openssl)"
}

# ── Secrets ───────────────────────────────────────────────────────────────────
resolve_secrets() {
    phase "Secrets"

    # ANTHROPIC_API_KEY: env var > backend/.env > prompt
    if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
        local envfile="$ROOT_DIR/backend/.env"
        if [[ -f "$envfile" ]]; then
            local val
            val="$(grep -E '^ANTHROPIC_API_KEY=' "$envfile" 2>/dev/null \
                  | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs 2>/dev/null || true)"
            [[ -n "$val" && "$val" != "sk-ant-..." ]] && ANTHROPIC_API_KEY="$val"
        fi
    fi
    if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
        printf "${YELLOW}?${NC} ANTHROPIC_API_KEY: "
        read -rs ANTHROPIC_API_KEY; echo
    fi
    [[ -n "${ANTHROPIC_API_KEY:-}" ]] || die "ANTHROPIC_API_KEY is required"
    ok "ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:0:14}..."

    # JWT_SECRET: env var > auto-generate
    if [[ -z "${JWT_SECRET:-}" ]]; then
        JWT_SECRET="$(openssl rand -hex 32)"
        warn "JWT_SECRET auto-generated: $JWT_SECRET"
        warn "Save this — redeploying with a different value will invalidate all sessions."
    fi
    ok "JWT_SECRET: ${JWT_SECRET:0:8}..."

    # DB_PASSWORD: env var > prompt
    if [[ -z "${DB_PASSWORD:-}" ]]; then
        printf "${YELLOW}?${NC} RDS password (min 8 chars, no / @ \" or spaces): "
        read -rs DB_PASSWORD; echo
    fi
    [[ ${#DB_PASSWORD} -ge 8 ]] || die "DB_PASSWORD must be at least 8 characters"
    # RDS rejects these chars in the master password
    [[ "$DB_PASSWORD" != *"/"* && "$DB_PASSWORD" != *"@"* && \
       "$DB_PASSWORD" != *'"'* && "$DB_PASSWORD" != *" "* ]] || \
        die "DB_PASSWORD must not contain: / @ \" or spaces"
    ok "DB_PASSWORD: set"
}

# ── AWS account info ──────────────────────────────────────────────────────────
get_account() {
    AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
    ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    IMAGE_URI="${ECR_REGISTRY}/${ECR_REPO}:${IMAGE_TAG}"
    info "Account: $AWS_ACCOUNT_ID | Region: $AWS_REGION | Tag: $IMAGE_TAG"
}

# ── Phase 1: ECR — build & push ───────────────────────────────────────────────
ecr_build_push() {
    phase "Phase 1/4 — ECR (build & push)"

    # Create repo if it doesn't exist
    if ! aws ecr describe-repositories --repository-names "$ECR_REPO" \
            --region "$AWS_REGION" &>/dev/null; then
        aws ecr create-repository \
            --repository-name "$ECR_REPO" \
            --image-scanning-configuration scanOnPush=true \
            --region "$AWS_REGION" --output json > /dev/null
        ok "ECR repo created: $ECR_REPO"
    else
        ok "ECR repo exists: $ECR_REPO"
    fi

    # Authenticate docker with ECR
    aws ecr get-login-password --region "$AWS_REGION" \
        | docker login --username AWS --password-stdin "$ECR_REGISTRY" 2>/dev/null
    ok "Docker authenticated with ECR"

    # Build for linux/amd64 (App Runner runs on x86)
    info "Building image — this may take a few minutes..."
    docker build --platform linux/amd64 --tag "$IMAGE_URI" "$ROOT_DIR"

    info "Pushing image to ECR..."
    docker push "$IMAGE_URI"
    ok "Pushed: $IMAGE_URI"
}

# ── Phase 2: Networking ───────────────────────────────────────────────────────
setup_networking() {
    phase "Phase 2/4 — Networking (VPC & security groups)"

    # Default VPC
    VPC_ID="$(aws ec2 describe-vpcs \
        --filters Name=isDefault,Values=true \
        --query 'Vpcs[0].VpcId' --output text --region "$AWS_REGION")"
    [[ "$VPC_ID" != "None" && -n "$VPC_ID" ]] || \
        die "No default VPC in $AWS_REGION. Set one up or export VPC_ID."
    ok "VPC: $VPC_ID"

    # Subnets — need ≥2 AZs for RDS subnet group
    SUBNETS=( $(aws ec2 describe-subnets \
        --filters Name=vpc-id,Values="$VPC_ID" Name=default-for-az,Values=true \
        --query 'Subnets[*].SubnetId' --output json --region "$AWS_REGION" \
        | jq -r '.[]') )
    [[ ${#SUBNETS[@]} -ge 2 ]] || \
        die "Need ≥2 default subnets in $AWS_REGION; found ${#SUBNETS[@]}"
    ok "Subnets: ${SUBNETS[*]}"

    # App Runner security group (used by VPC connector for egress to RDS)
    SG_AR_ID="$(aws ec2 describe-security-groups \
        --filters Name=group-name,Values="$SG_APPRUNNER" Name=vpc-id,Values="$VPC_ID" \
        --query 'SecurityGroups[0].GroupId' --output text \
        --region "$AWS_REGION" 2>/dev/null || true)"
    if [[ -z "$SG_AR_ID" || "$SG_AR_ID" == "None" ]]; then
        SG_AR_ID="$(aws ec2 create-security-group \
            --group-name "$SG_APPRUNNER" \
            --description "$APP_NAME App Runner VPC connector" \
            --vpc-id "$VPC_ID" \
            --query 'GroupId' --output text --region "$AWS_REGION")"
        ok "App Runner SG created: $SG_AR_ID"
    else
        ok "App Runner SG exists: $SG_AR_ID"
    fi

    # RDS security group — ingress 5432 from App Runner SG only
    SG_RDS_ID="$(aws ec2 describe-security-groups \
        --filters Name=group-name,Values="$SG_RDS" Name=vpc-id,Values="$VPC_ID" \
        --query 'SecurityGroups[0].GroupId' --output text \
        --region "$AWS_REGION" 2>/dev/null || true)"
    if [[ -z "$SG_RDS_ID" || "$SG_RDS_ID" == "None" ]]; then
        SG_RDS_ID="$(aws ec2 create-security-group \
            --group-name "$SG_RDS" \
            --description "$APP_NAME RDS PostgreSQL" \
            --vpc-id "$VPC_ID" \
            --query 'GroupId' --output text --region "$AWS_REGION")"
        ok "RDS SG created: $SG_RDS_ID"
    else
        ok "RDS SG exists: $SG_RDS_ID"
    fi

    # Ingress: RDS SG allows 5432 from App Runner SG (idempotent — ignore duplicate error)
    aws ec2 authorize-security-group-ingress \
        --group-id "$SG_RDS_ID" \
        --protocol tcp --port 5432 \
        --source-group "$SG_AR_ID" \
        --region "$AWS_REGION" &>/dev/null || true
    ok "RDS SG ingress: port 5432 ← $SG_AR_ID"
}

# ── Phase 3: RDS ──────────────────────────────────────────────────────────────
setup_rds() {
    phase "Phase 3/4 — RDS (PostgreSQL 16)"

    # Subnet group
    if ! aws rds describe-db-subnet-groups \
            --db-subnet-group-name "$RDS_SUBNET_GRP" \
            --region "$AWS_REGION" &>/dev/null; then
        aws rds create-db-subnet-group \
            --db-subnet-group-name "$RDS_SUBNET_GRP" \
            --db-subnet-group-description "$APP_NAME subnet group" \
            --subnet-ids "${SUBNETS[@]}" \
            --region "$AWS_REGION" --output json > /dev/null
        ok "RDS subnet group created: $RDS_SUBNET_GRP"
    else
        ok "RDS subnet group exists: $RDS_SUBNET_GRP"
    fi

    # Instance
    RDS_STATUS="$(aws rds describe-db-instances \
        --db-instance-identifier "$RDS_ID" \
        --query 'DBInstances[0].DBInstanceStatus' --output text \
        --region "$AWS_REGION" 2>/dev/null || echo not-found)"

    if [[ "$RDS_STATUS" == "not-found" ]]; then
        info "Creating RDS instance — takes ~5 minutes..."
        aws rds create-db-instance \
            --db-instance-identifier "$RDS_ID" \
            --db-instance-class "$DB_INSTANCE_CLASS" \
            --engine postgres \
            --engine-version "16" \
            --master-username "$DB_USER" \
            --master-user-password "$DB_PASSWORD" \
            --db-name "$DB_NAME" \
            --allocated-storage 20 \
            --storage-type gp3 \
            --no-multi-az \
            --no-publicly-accessible \
            --db-subnet-group-name "$RDS_SUBNET_GRP" \
            --vpc-security-group-ids "$SG_RDS_ID" \
            --backup-retention-period 7 \
            --deletion-protection \
            --region "$AWS_REGION" --output json > /dev/null
        ok "RDS instance creation started: $RDS_ID"
    else
        info "RDS instance exists (status: $RDS_STATUS)"
    fi

    info "Waiting for RDS to reach 'available'..."
    aws rds wait db-instance-available \
        --db-instance-identifier "$RDS_ID" \
        --region "$AWS_REGION"

    RDS_HOST="$(aws rds describe-db-instances \
        --db-instance-identifier "$RDS_ID" \
        --query 'DBInstances[0].Endpoint.Address' --output text \
        --region "$AWS_REGION")"
    DATABASE_URL="postgresql+asyncpg://${DB_USER}:${DB_PASSWORD}@${RDS_HOST}:5432/${DB_NAME}"
    ok "RDS endpoint: $RDS_HOST"
}

# ── IAM role for ECR pull ─────────────────────────────────────────────────────
ensure_iam_role() {
    ROLE_ARN="$(aws iam get-role \
        --role-name "$IAM_ROLE" \
        --query 'Role.Arn' --output text 2>/dev/null || echo none)"

    if [[ "$ROLE_ARN" == "none" ]]; then
        ROLE_ARN="$(aws iam create-role \
            --role-name "$IAM_ROLE" \
            --assume-role-policy-document '{
              "Version":"2012-10-17",
              "Statement":[{
                "Effect":"Allow",
                "Principal":{"Service":"build.apprunner.amazonaws.com"},
                "Action":"sts:AssumeRole"
              }]
            }' \
            --query 'Role.Arn' --output text)"
        aws iam attach-role-policy \
            --role-name "$IAM_ROLE" \
            --policy-arn "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
        info "IAM role created — waiting 15s for propagation..."
        sleep 15
        ok "IAM role: $ROLE_ARN"
    else
        ok "IAM role: $ROLE_ARN"
    fi
}

# ── Phase 4: App Runner ───────────────────────────────────────────────────────
deploy_apprunner() {
    phase "Phase 4/4 — App Runner"

    ensure_iam_role

    # VPC Connector (lets App Runner reach RDS in the VPC)
    CONNECTOR_ARN="$(aws apprunner list-vpc-connectors \
        --region "$AWS_REGION" \
        --query "VpcConnectors[?VpcConnectorName=='$VPC_CONNECTOR' && Status=='ACTIVE'] | [0].VpcConnectorArn" \
        --output text 2>/dev/null || true)"

    if [[ -z "$CONNECTOR_ARN" || "$CONNECTOR_ARN" == "None" ]]; then
        # Retry, dropping any subnets in AZs that App Runner doesn't support
        local ar_subnets=("${SUBNETS[@]}")
        while true; do
            [[ ${#ar_subnets[@]} -ge 1 ]] || \
                die "No App Runner-compatible subnets found. Try a different region."
            local out
            out="$(aws apprunner create-vpc-connector \
                --vpc-connector-name "$VPC_CONNECTOR" \
                --subnets "${ar_subnets[@]}" \
                --security-groups "$SG_AR_ID" \
                --query 'VpcConnector.VpcConnectorArn' --output text \
                --region "$AWS_REGION" 2>&1)" && { CONNECTOR_ARN="$out"; break; }
            # Parse the bad subnet IDs from the error message and retry without them
            local bad
            bad="$(echo "$out" | grep -oE 'subnet-[a-f0-9]+' || true)"
            [[ -n "$bad" ]] || die "VPC connector creation failed: $out"
            warn "Removing App Runner-incompatible subnets: $bad"
            local filtered=()
            for s in "${ar_subnets[@]}"; do
                echo "$bad" | grep -qw "$s" || filtered+=("$s")
            done
            ar_subnets=("${filtered[@]}")
        done
        ok "VPC connector created: $VPC_CONNECTOR"
    else
        ok "VPC connector exists: $VPC_CONNECTOR"
    fi

    # NOTE: Frontend is bundled into FastAPI's static/ directory and served from
    # the same origin. All browser requests are same-origin so CORS is not needed.
    # If you add a custom domain or separate frontend host, add CORS_ORIGINS here.

    # Source configuration (shared between create and update)
    cat > "$TMPDIR_LOCAL/source-config.json" <<EOF
{
    "ImageRepository": {
        "ImageIdentifier": "$IMAGE_URI",
        "ImageRepositoryType": "ECR",
        "ImageConfiguration": {
            "Port": "$APP_PORT",
            "RuntimeEnvironmentVariables": {
                "DATABASE_URL": "$DATABASE_URL",
                "ANTHROPIC_API_KEY": "$ANTHROPIC_API_KEY",
                "JWT_SECRET": "$JWT_SECRET",
                "WEB_CONCURRENCY": "1",
                "LOG_LEVEL": "info"
            }
        }
    },
    "AutoDeploymentsEnabled": false,
    "AuthenticationConfiguration": {
        "AccessRoleArn": "$ROLE_ARN"
    }
}
EOF

    # Check if service already exists
    EXISTING_ARN="$(aws apprunner list-services \
        --region "$AWS_REGION" \
        --query "ServiceSummaryList[?ServiceName=='$AR_SERVICE'].ServiceArn | [0]" \
        --output text 2>/dev/null || true)"

    if [[ -z "$EXISTING_ARN" || "$EXISTING_ARN" == "None" ]]; then
        # ── Create ──
        info "Creating App Runner service: $AR_SERVICE"

        cat > "$TMPDIR_LOCAL/create-service.json" <<EOF
{
    "ServiceName": "$AR_SERVICE",
    "SourceConfiguration": $(cat "$TMPDIR_LOCAL/source-config.json"),
    "InstanceConfiguration": {
        "Cpu": "$APP_RUNNER_CPU",
        "Memory": "$APP_RUNNER_MEMORY"
    },
    "HealthCheckConfiguration": {
        "Protocol": "HTTP",
        "Path": "/api/health",
        "Interval": 10,
        "Timeout": 5,
        "HealthyThreshold": 1,
        "UnhealthyThreshold": 5
    },
    "NetworkConfiguration": {
        "EgressConfiguration": {
            "EgressType": "VPC",
            "VpcConnectorArn": "$CONNECTOR_ARN"
        },
        "IngressConfiguration": {
            "IsPubliclyAccessible": true
        }
    }
}
EOF
        SERVICE_ARN="$(aws apprunner create-service \
            --cli-input-json "file://$TMPDIR_LOCAL/create-service.json" \
            --query 'Service.ServiceArn' --output text \
            --region "$AWS_REGION")"
        ok "Service created: $SERVICE_ARN"

    else
        # ── Update — deploy new image + env vars ──
        SERVICE_ARN="$EXISTING_ARN"
        info "Updating existing service: $SERVICE_ARN"
        aws apprunner update-service \
            --service-arn "$SERVICE_ARN" \
            --source-configuration "file://$TMPDIR_LOCAL/source-config.json" \
            --region "$AWS_REGION" --output json > /dev/null
        ok "Service update triggered"
    fi

    # Wait for RUNNING
    info "Waiting for service to reach RUNNING state (typically 3–5 min)..."
    local dots=0
    while true; do
        STATUS="$(aws apprunner describe-service \
            --service-arn "$SERVICE_ARN" \
            --query 'Service.Status' --output text \
            --region "$AWS_REGION")"
        case "$STATUS" in
            RUNNING)
                echo; ok "Service is RUNNING"; break ;;
            *FAILED*)
                echo; die "Deployment failed (status: $STATUS). Check App Runner console for logs." ;;
            *)
                printf "."
                (( dots++ ))
                [[ $((dots % 30)) -eq 0 ]] && echo " ($STATUS)"
                sleep 10 ;;
        esac
    done

    SERVICE_URL="$(aws apprunner describe-service \
        --service-arn "$SERVICE_ARN" \
        --query 'Service.ServiceUrl' --output text \
        --region "$AWS_REGION")"
}

# ── Summary ───────────────────────────────────────────────────────────────────
print_summary() {
    echo
    echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}${BOLD}  Deployment complete!${NC}"
    echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo
    echo "  App URL    https://$SERVICE_URL"
    echo "  RDS host   $RDS_HOST"
    echo "  Image      $IMAGE_URI"
    echo "  Region     $AWS_REGION"
    echo
    echo "  Useful commands:"
    echo
    echo "    # View deployment operations"
    echo "    aws apprunner list-operations --service-arn $SERVICE_ARN --region $AWS_REGION"
    echo
    echo "    # Force redeploy (same image)"
    echo "    aws apprunner start-deployment --service-arn $SERVICE_ARN --region $AWS_REGION"
    echo
    echo "    # Pause to stop billing (preserves config)"
    echo "    aws apprunner pause-service --service-arn $SERVICE_ARN --region $AWS_REGION"
    echo "    aws apprunner resume-service --service-arn $SERVICE_ARN --region $AWS_REGION"
    echo
    echo "  Notes:"
    echo "    • RDS has deletion protection enabled — disable before tearing down:"
    echo "      aws rds modify-db-instance --db-instance-identifier $RDS_ID \\"
    echo "        --no-deletion-protection --apply-immediately --region $AWS_REGION"
    echo "    • RDS is not publicly accessible — connect via App Runner or a bastion host"
    echo "    • Database migrations run automatically on each container start (entrypoint.sh)"
    echo
}

# ── Entry point ───────────────────────────────────────────────────────────────
main() {
    echo
    echo "  ┌─────────────────────────────────────────────┐"
    echo "  │   1111 School — AWS App Runner + RDS Deploy  │"
    echo "  └─────────────────────────────────────────────┘"

    preflight
    resolve_secrets
    get_account
    ecr_build_push
    setup_networking
    setup_rds
    deploy_apprunner
    print_summary
}

main "$@"
