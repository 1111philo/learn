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
