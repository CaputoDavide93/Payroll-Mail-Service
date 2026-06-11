# =============================================================================
# AWS Secrets Manager — all app secrets in one JSON secret
# =============================================================================

resource "aws_secretsmanager_secret" "app_config" {
  name                    = "payroll-mail-service/${var.environment}/config"
  description             = "Payroll Mail Service — SMTP credentials, app password, API keys"
  recovery_window_in_days = 7

  tags = {
    Name  = "payroll-mail-service-config"
    Owner = "Davide Caputo"
  }
}

resource "aws_secretsmanager_secret_version" "app_config" {
  secret_id = aws_secretsmanager_secret.app_config.id

  secret_string = jsonencode({
    APP_PASSWORD      = var.app_password
    SMTP_HOST         = var.smtp_host
    SMTP_PORT         = tostring(var.smtp_port)
    SMTP_USER         = var.smtp_user
    SMTP_PASS         = var.smtp_pass
    FROM_EMAIL        = var.from_email
    FROM_NAME         = var.from_name
    DAILY_LIMIT       = tostring(var.daily_limit)
    ANTHROPIC_API_KEY = var.anthropic_api_key
  })
}

# =============================================================================
# IAM role — lets the EC2 instance read its own secret, nothing else
# =============================================================================

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2" {
  name               = "payroll-mail-service-ec2-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json

  tags = {
    Name  = "payroll-mail-service-ec2-role"
    Owner = "Davide Caputo"
  }
}

data "aws_iam_policy_document" "read_secret" {
  statement {
    sid     = "ReadAppSecret"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.app_config.arn
    ]
  }
}

resource "aws_iam_role_policy" "read_secret" {
  name   = "payroll-mail-read-secret"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.read_secret.json
}

resource "aws_iam_instance_profile" "ec2" {
  name = "payroll-mail-service-${var.environment}"
  role = aws_iam_role.ec2.name

  tags = {
    Name  = "payroll-mail-service-instance-profile"
    Owner = "Davide Caputo"
  }
}
