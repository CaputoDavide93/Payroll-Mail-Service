# =============================================================================
# Payroll Mail Service — EC2 deployment (eu-west-1)
# =============================================================================
# Single t3.micro running the app in Docker with an Elastic IP.
#
# First-time setup:
#   1. cd terraform/bootstrap && terraform init && terraform apply && cd ..
#   2. terraform init
#   3. cp terraform.tfvars.example terraform.tfvars  # fill in non-secret vars
#   4. export TF_VAR_app_password="your-ui-password"
#      export TF_VAR_smtp_user="you@example.com"
#      export TF_VAR_smtp_pass="your-gmail-app-password"
#      export TF_VAR_from_email="you@example.com"
#      export TF_VAR_anthropic_api_key="sk-ant-..."   # optional
#   5. terraform plan
#   6. terraform apply
# =============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.0"
    }
  }

  backend "s3" {
    bucket         = "payroll-mail-tf-state-054904986477"
    key            = "payroll-mail-service/terraform.tfstate"
    region         = "eu-west-1"
    dynamodb_table = "payroll-mail-tf-locks"
    encrypt        = true
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  allowed_account_ids = ["054904986477"]

  default_tags {
    tags = {
      Application = "PayrollMailService"
      Environment = var.environment
      ManagedBy   = "terraform"
      Owner       = "Davide Caputo - TechOps"
    }
  }
}
