# =============================================================================
# AWS Secrets Manager — all app secrets in one JSON secret
# =============================================================================

resource "aws_secretsmanager_secret" "app_config" {
  name                    = "payroll-mail-service/${var.environment}/config"
  description             = "Payroll Mail Service — SMTP credentials, app password, API keys"
  recovery_window_in_days = 7

  tags = {
    Name  = "payroll-mail-service-config"
    Owner = "YOUR_TEAM"
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

  # Values are managed out-of-band in Secrets Manager. Without this, an apply run
  # without the TF_VAR_* secrets set would overwrite the live secret with blanks.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# =============================================================================
# IAM role — read its own secret, pull its own image, ACME DNS-01, SSM
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
    Owner = "YOUR_TEAM"
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

# Pull the app image from its ECR repo (GetAuthorizationToken can't be resource-scoped).
data "aws_iam_policy_document" "ecr_pull" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid = "EcrPull"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.this.arn]
  }
}

resource "aws_iam_role_policy" "ecr_pull" {
  name   = "payroll-mail-ecr-pull"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.ecr_pull.json
}

# Let's Encrypt DNS-01 (certbot --dns-route53 on the instance): find the zone, write
# only the _acme-challenge TXT record for our domain, and poll for the change.
data "aws_iam_policy_document" "acme_dns" {
  statement {
    sid       = "FindZone"
    actions   = ["route53:ListHostedZones"]
    resources = ["*"]
  }
  statement {
    sid       = "AcmeChallengeRecord"
    actions   = ["route53:ChangeResourceRecordSets"]
    resources = [data.aws_route53_zone.this.arn]
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "route53:ChangeResourceRecordSetsNormalizedRecordNames"
      values   = ["_acme-challenge.${lower(var.domain_name)}"]
    }
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "route53:ChangeResourceRecordSetsRecordTypes"
      values   = ["TXT"]
    }
  }
  statement {
    sid       = "PollChange"
    actions   = ["route53:GetChange"]
    resources = ["arn:aws:route53:::change/*"]
  }
}

resource "aws_iam_role_policy" "acme_dns" {
  name   = "payroll-mail-acme-dns"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.acme_dns.json
}

# SSM Session Manager / Run Command: used by deploy.sh to roll the container,
# and the replacement for SSH.
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2" {
  name = "payroll-mail-service-${var.environment}"
  role = aws_iam_role.ec2.name

  tags = {
    Name  = "payroll-mail-service-instance-profile"
    Owner = "YOUR_TEAM"
  }
}
