# =============================================================================
# Bootstrap — run ONCE before `terraform init` in the parent directory.
# Creates the S3 bucket and DynamoDB table used as the Terraform backend.
#
# Usage:
#   cd terraform/bootstrap
#   terraform init
#   terraform apply
#   cd ..
#   terraform init   ← now the S3 backend is available
# =============================================================================

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  # Bootstrap state is stored locally — it only manages 2 resources.
}

provider "aws" {
  region  = "eu-west-1"
  profile = "default"

  allowed_account_ids = ["054904986477"]

  default_tags {
    tags = {
      Application = "PayrollMailService"
      ManagedBy   = "Terraform"
      Owner       = "Davide Caputo"
    }
  }
}

resource "aws_s3_bucket" "tf_state" {
  bucket = "payroll-mail-tf-state-054904986477"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tf_state" {
  bucket                  = aws_s3_bucket.tf_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "tf_locks" {
  name         = "payroll-mail-tf-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

output "state_bucket" {
  value = aws_s3_bucket.tf_state.bucket
}

output "lock_table" {
  value = aws_dynamodb_table.tf_locks.name
}
