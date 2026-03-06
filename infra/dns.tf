# Route 53 + App Runner custom domain
# Only created when domain_name and hosted_zone_name are provided.

data "aws_route53_zone" "main" {
  count = var.hosted_zone_name != "" ? 1 : 0
  name  = var.hosted_zone_name
}

resource "aws_apprunner_custom_domain_association" "app" {
  count       = var.domain_name != "" ? 1 : 0
  domain_name = var.domain_name
  service_arn = aws_apprunner_service.app.arn
}

# App Runner provides certificate validation records — create them in Route 53
resource "aws_route53_record" "cert_validation" {
  for_each = var.domain_name != "" ? {
    for r in aws_apprunner_custom_domain_association.app[0].certificate_validation_records :
    r.name => r
  } : {}

  zone_id = data.aws_route53_zone.main[0].zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 300
  records = [each.value.value]
}

# CNAME pointing the custom domain to the App Runner service URL
resource "aws_route53_record" "app" {
  count   = var.domain_name != "" ? 1 : 0
  zone_id = data.aws_route53_zone.main[0].zone_id
  name    = var.domain_name
  type    = "CNAME"
  ttl     = 300
  records = [aws_apprunner_service.app.service_url]
}
