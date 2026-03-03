output "app_url" {
  description = "App Runner service URL"
  value       = "https://${aws_apprunner_service.app.service_url}"
}

output "ecr_repository_url" {
  description = "ECR repository URL (for docker push)"
  value       = aws_ecr_repository.app.repository_url
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint"
  value       = aws_db_instance.main.endpoint
}

output "apprunner_service_arn" {
  description = "App Runner service ARN"
  value       = aws_apprunner_service.app.arn
}
