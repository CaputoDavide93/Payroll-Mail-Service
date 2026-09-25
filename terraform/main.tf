# =============================================================================
# Payroll Mail Service — EC2 deployment (eu-west-1)
# =============================================================================
# Single t3.micro with Elastic IP at https://<domain_name> (office IPs
# only). nginx on the instance terminates TLS with a Let's Encrypt certificate.
# The instance pulls its image from ECR (deploy.sh builds and pushes it).
# Secrets stored in AWS Secrets Manager. Keep it stopped between pay runs.
#
# First-time setup:
#   1. cd terraform/bootstrap && terraform init && terraform apply && cd ..
#   2. set the state bucket name in the backend block below, then: terraform init
#   3. cp terraform.tfvars.example terraform.tfvars  # fill in non-secret vars
#   4. Set secrets as env vars (never in files):
#        export TF_VAR_app_password="your-ui-password"
#        export TF_VAR_smtp_user="you@example.com"
#        export TF_VAR_smtp_pass="your-gmail-app-password"
#        export TF_VAR_from_email="you@example.com"
#        export TF_VAR_anthropic_api_key="sk-ant-..."   # optional
#   5. terraform plan
#   6. terraform apply
#   7. ../deploy.sh   # build + push the image to ECR and roll the instance
#
# After apply:
#   - Secrets are in AWS Secrets Manager (payroll-mail-service/prod/config)
#   - The EC2 instance fetches them at boot via its IAM role
#   - Private key saved to terraform/payroll-mail-service.pem
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
    # Backends cannot use variables: replace 123456789012 with your AWS account
    # ID (the bucket terraform/bootstrap created), or pass
    # -backend-config="bucket=..." to terraform init.
    bucket         = "payroll-mail-tf-state-123456789012"
    key            = "payroll-mail-service/terraform.tfstate"
    region         = "eu-west-1"
    dynamodb_table = "payroll-mail-tf-locks"
    encrypt        = true
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  allowed_account_ids = length(var.allowed_account_ids) > 0 ? var.allowed_account_ids : null

  default_tags {
    tags = {
      Application = "PayrollMailService"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Owner       = "Davide Caputo"
    }
  }
}
