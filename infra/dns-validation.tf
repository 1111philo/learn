# Certificate validation records for App Runner custom domain.
# These are created in a second apply after the custom domain association exists.
# On first apply, set create_validation_records = false (the default).

variable "create_validation_records" {
  description = "Set to true on second apply to create cert validation DNS records"
  type        = bool
  default     = false
}

resource "aws_route53_record" "cert_validation" {
  for_each = var.create_validation_records && var.domain_name != "" ? {
    for r in aws_apprunner_custom_domain_association.app[0].certificate_validation_records :
    r.name => r
  } : {}

  zone_id = aws_route53_zone.main[0].zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 300
  records = [each.value.value]
}
