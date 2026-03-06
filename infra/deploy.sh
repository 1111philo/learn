#!/usr/bin/env bash
set -euo pipefail

ENV="${1:-prod}"
TFVARS="envs/${ENV}.tfvars"

if [[ ! -f "infra/${TFVARS}" ]]; then
  echo "Error: infra/${TFVARS} not found. Usage: ./infra/deploy.sh [prod|test]"
  exit 1
fi

echo "==> Deploying environment: ${ENV}"

# Select or create Terraform workspace
cd infra
terraform workspace select "$ENV" 2>/dev/null || terraform workspace new "$ENV"

# Get values from Terraform output
ECR_URL=$(terraform output -raw ecr_repository_url 2>/dev/null) || {
  echo "Error: Could not read Terraform outputs. Run 'cd infra && terraform apply -var-file=${TFVARS}' first."
  exit 1
}

REGION=$(aws configure get region 2>/dev/null || echo "us-east-1")

echo "==> Authenticating with ECR..."
aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "$ECR_URL"

echo "==> Building Docker image..."
cd ..
docker build --platform linux/amd64 -t "$ECR_URL:latest" .

echo "==> Pushing to ECR..."
docker push "$ECR_URL:latest"

echo "==> Triggering App Runner deployment..."
cd infra
SERVICE_ARN=$(terraform output -raw apprunner_service_arn 2>/dev/null) || {
  echo "Error: Could not find App Runner service ARN. Check that Terraform has been applied."
  exit 1
}

aws apprunner start-deployment --service-arn "$SERVICE_ARN"

echo "==> Deployment triggered for ${ENV}. Check status with:"
echo "    aws apprunner describe-service --service-arn $SERVICE_ARN --query 'Service.Status'"
echo ""
echo "==> App URL:"
terraform output -raw app_url
echo ""
