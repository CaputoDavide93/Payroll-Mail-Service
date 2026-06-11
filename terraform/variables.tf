variable "aws_region" {
  type    = string
  default = "eu-west-1"
  validation {
    condition     = var.aws_region == "eu-west-1"
    error_message = "This project must be deployed to eu-west-1 only."
  }
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

# SSH access — restrict to your IP in production.
# Find your current IP: curl -s https://checkip.amazonaws.com
variable "ssh_cidr" {
  type        = string
  default     = "0.0.0.0/0"
  description = "CIDR allowed SSH access. Restrict to your IP: e.g. \"81.2.69.142/32\"."
}

variable "git_repo_url" {
  type    = string
  default = "https://github.com/CaputoDavide93/Payroll-Mail-Service.git"
}

variable "git_branch" {
  type    = string
  default = "main"
}

# ---- Secrets — set via TF_VAR_* env vars, never commit values ----

variable "app_password" {
  type        = string
  sensitive   = true
  description = "Password that protects the web UI. Required on a public server."
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
  type        = string
  sensitive   = true
  description = "Gmail / Workspace address used for sending."
}

variable "smtp_pass" {
  type        = string
  sensitive   = true
  description = "Gmail App Password (16 characters)."
}

variable "from_email" {
  type        = string
  sensitive   = true
  description = "Address shown as the sender (usually same as smtp_user)."
}

variable "from_name" {
  type        = string
  default     = "Payroll Team"
}

variable "daily_limit" {
  type    = number
  default = 1800
}

variable "anthropic_api_key" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Enables AI matching and pre-flight check for payslips. Optional."
}
