# Route 53 hosted zone — created once, shared across environments.
# After first apply, update nameservers at your domain registrar.
resource "aws_route53_zone" "main" {
  count = var.hosted_zone_name != "" ? 1 : 0
  name  = var.hosted_zone_name

  tags = { Name = var.hosted_zone_name }
}

# App Runner custom domain association
resource "aws_apprunner_custom_domain_association" "app" {
  count       = var.domain_name != "" ? 1 : 0
  domain_name = var.domain_name
  service_arn = aws_apprunner_service.app.arn
}

# CNAME pointing the custom domain to the App Runner service URL
resource "aws_route53_record" "app" {
  count   = var.domain_name != "" ? 1 : 0
  zone_id = aws_route53_zone.main[0].zone_id
  name    = var.domain_name
  type    = "CNAME"
  ttl     = 300
  records = [aws_apprunner_service.app.service_url]
}

output "nameservers" {
  description = "Update these nameservers at your domain registrar"
  value       = var.hosted_zone_name != "" ? aws_route53_zone.main[0].name_servers : []
}

output "cert_validation_note" {
  description = "After first apply, create cert validation records"
  value       = var.domain_name != "" ? "Run: terraform apply -var-file=envs/test.tfvars -var-file=terraform.tfvars to create cert validation records after custom domain is associated" : ""
}
