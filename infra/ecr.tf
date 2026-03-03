resource "aws_ecr_repository" "app" {
  name                 = var.app_name
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = false
  }

  tags = { Name = "${var.app_name}-ecr" }
}

# Build and push the Docker image to ECR so App Runner has something to pull.
# Runs on first apply and whenever the image hash changes.
resource "null_resource" "docker_push" {
  depends_on = [aws_ecr_repository.app]

  triggers = {
    # Re-push when the source code changes
    src_hash = sha1(join("", [
      filesha1("${path.module}/../Dockerfile"),
      filesha1("${path.module}/../backend/pyproject.toml"),
      filesha1("${path.module}/../frontend/package.json"),
    ]))
  }

  provisioner "local-exec" {
    working_dir = "${path.module}/.."
    command     = <<-EOT
      aws ecr get-login-password --region ${var.aws_region} --profile ${var.aws_profile} \
        | docker login --username AWS --password-stdin ${aws_ecr_repository.app.repository_url} && \
      docker build --platform linux/amd64 -t ${aws_ecr_repository.app.repository_url}:latest . && \
      docker push ${aws_ecr_repository.app.repository_url}:latest
    EOT
  }
}

# Clean up old images to save storage costs
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 5 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = { type = "expire" }
    }]
  })
}
