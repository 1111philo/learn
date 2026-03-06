variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "AWS CLI profile to use"
  type        = string
  default     = "default"
}

variable "app_name" {
  description = "Application name, used as prefix for resource names"
  type        = string
  default     = "learn"
}

variable "environment" {
  description = "Environment name (e.g. prod, test). Used to isolate resources."
  type        = string
  default     = "prod"
}

variable "domain_name" {
  description = "Custom domain for the App Runner service (e.g. test-1111.philosophers.group)"
  type        = string
  default     = ""
}

variable "hosted_zone_name" {
  description = "Route 53 hosted zone name (e.g. philosophers.group)"
  type        = string
  default     = ""
}

variable "anthropic_api_key" {
  description = "Anthropic API key for LLM calls"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "Secret key for signing JWT tokens"
  type        = string
  sensitive   = true
}

variable "default_model" {
  description = "Default LLM model identifier"
  type        = string
  default     = "anthropic:claude-sonnet-4-6"
}

variable "db_password" {
  description = "Password for the RDS PostgreSQL database"
  type        = string
  sensitive   = true
}
