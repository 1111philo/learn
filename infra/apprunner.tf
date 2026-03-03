# IAM role for App Runner to pull from ECR
resource "aws_iam_role" "apprunner_ecr" {
  name = "${var.app_name}-apprunner-ecr-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "build.apprunner.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "apprunner_ecr" {
  role       = aws_iam_role.apprunner_ecr.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

resource "aws_apprunner_service" "app" {
  depends_on   = [null_resource.docker_push]
  service_name = var.app_name

  source_configuration {
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_ecr.arn
    }

    image_repository {
      image_identifier      = "${aws_ecr_repository.app.repository_url}:latest"
      image_repository_type = "ECR"

      image_configuration {
        port = "8000"

        runtime_environment_variables = {
          DATABASE_URL      = "postgresql+asyncpg://${var.app_name}:${var.db_password}@${aws_db_instance.main.endpoint}/${var.app_name}"
          ANTHROPIC_API_KEY = var.anthropic_api_key
          JWT_SECRET        = var.jwt_secret
          DEFAULT_MODEL     = var.default_model
          WEB_CONCURRENCY   = "1"
        }
      }
    }

    auto_deployments_enabled = false
  }

  instance_configuration {
    cpu    = "512"  # 0.5 vCPU
    memory = "1024" # 1 GB
  }

  health_check_configuration {
    protocol            = "HTTP"
    path                = "/api/health"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 1
    unhealthy_threshold = 3
  }

  tags = { Name = "${var.app_name}-apprunner" }
}
