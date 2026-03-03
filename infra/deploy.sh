#!/usr/bin/env bash
set -euo pipefail

# Get values from Terraform output
ECR_URL=$(terraform -chdir=infra output -raw ecr_repository_url 2>/dev/null) || {
  echo "Error: Could not read Terraform outputs. Run 'cd infra && terraform apply' first."
  exit 1
}

REGION=$(aws configure get region 2>/dev/null || echo "us-east-1")
ACCOUNT_ID=$(echo "$ECR_URL" | cut -d. -f1)

echo "==> Authenticating with ECR..."
aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "$ECR_URL"

echo "==> Building Docker image..."
docker build --platform linux/amd64 -t "$ECR_URL:latest" .

echo "==> Pushing to ECR..."
docker push "$ECR_URL:latest"

echo "==> Triggering App Runner deployment..."
SERVICE_ARN=$(terraform -chdir=infra output -raw apprunner_service_arn 2>/dev/null) || {
  echo "Error: Could not find App Runner service ARN. Check that Terraform has been applied."
  exit 1
}

aws apprunner start-deployment --service-arn "$SERVICE_ARN"

echo "==> Deployment triggered. Check status with:"
echo "    aws apprunner describe-service --service-arn $SERVICE_ARN --query 'Service.Status'"
echo ""
echo "==> App URL:"
terraform -chdir=infra output -raw app_url
echo ""
