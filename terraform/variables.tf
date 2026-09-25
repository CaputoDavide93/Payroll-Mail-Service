variable "aws_region" {
  type    = string
  default = "eu-west-1"
  validation {
    condition     = var.aws_region == "eu-west-1"
    error_message = "This project must be deployed to eu-west-1 only."
  }
}

variable "allowed_account_ids" {
  type        = list(string)
  default     = []
  description = "Optional guard: AWS account IDs Terraform may apply to (empty = no check)."
}

variable "aws_profile" {
  type    = string
  default = "default"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "instance_type" {
  type    = string
  default = "t3.micro"
}

variable "root_volume_size_gb" {
  type    = number
  default = 20
}

variable "ssh_cidr" {
  type        = string
  description = "CIDR allowed SSH (port 22). No default: set it to the office IP, e.g. \"203.0.113.10/32\". Prefer SSM Session Manager."
}

variable "office_cidrs" {
  type        = list(string)
  description = "CIDRs allowed to reach the instance on 443/80 (your office IPs). No default."
}

variable "hosted_zone" {
  type        = string
  description = "Existing Route53 hosted zone, e.g. \"aws.example.com\"."
}

variable "domain_name" {
  type        = string
  description = "FQDN for the app inside hosted_zone, e.g. \"payroll.aws.example.com\"."
}

variable "acme_email" {
  type        = string
  default     = ""
  description = "Optional contact email for the Let's Encrypt account (empty = register without email)."
}

variable "nginx_image" {
  type        = string
  default     = "nginx:1.30.5-alpine"
  description = "TLS-terminating reverse proxy image (pinned)."
}

variable "certbot_image" {
  type        = string
  default     = "certbot/dns-route53:v5.8.0"
  description = "Certbot image with the Route53 DNS-01 plugin (pinned)."
}

variable "image_tag" {
  type        = string
  default     = "latest"
  description = "ECR image tag the instance pulls at first boot. deploy.sh rolls to a specific git-sha tag."
}

variable "smtp_host_allowlist" {
  type        = string
  default     = "smtp.gmail.com,smtp-relay.gmail.com"
  description = "Comma-separated SMTP hosts the UI may configure (SMTP_HOST_ALLOWLIST)."
}

variable "payslip_retention_days" {
  type        = number
  default     = 7
  description = "Delete prepared payslip runs this many days after preparation (0 = never)."
}

variable "payslip_delete_after_send" {
  type        = bool
  default     = true
  description = "Delete each protected payslip PDF as soon as it has been sent."
}

# ---- Secrets ----------------------------------------------------------------
# Leave empty here — fill them in via AWS Secrets Manager console after apply.
# The EC2 instance waits at boot until real values are present before starting.

variable "app_password" {
  type      = string
  sensitive = true
  default   = ""
}

variable "smtp_host" {
  type    = string
  default = "smtp.gmail.com"
}

variable "smtp_port" {
  type    = number
  default = 465
}

variable "smtp_user" {
  type      = string
  sensitive = true
  default   = ""
}

variable "smtp_pass" {
  type      = string
  sensitive = true
  default   = ""
}

variable "from_email" {
  type      = string
  sensitive = true
  default   = ""
}

variable "from_name" {
  type    = string
  default = "Payroll Team"
}

variable "daily_limit" {
  type    = number
  default = 1800
}

variable "anthropic_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
