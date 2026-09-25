# =============================================================================
# ECR — the instance pulls a pre-built image instead of building from git
# =============================================================================

resource "aws_ecr_repository" "this" {
  name                 = "payroll-mail-service"
  image_tag_mutability = "MUTABLE" # :latest / :base move; :<git sha> tags are never reused

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name  = "payroll-mail-service"
    Owner = "Davide Caputo"
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Protect :base (weekly patch job builds FROM it)"
        selection    = { tagStatus = "tagged", tagPrefixList = ["base"], countType = "imageCountMoreThan", countNumber = 1 }
        action       = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Protect :latest"
        selection    = { tagStatus = "tagged", tagPrefixList = ["latest"], countType = "imageCountMoreThan", countNumber = 1 }
        action       = { type = "expire" }
      },
      {
        rulePriority = 3
        description  = "Expire untagged images after 7 days"
        selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 7 }
        action       = { type = "expire" }
      },
      {
        rulePriority = 4
        description  = "Keep last 10 images"
        selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
        action       = { type = "expire" }
      },
    ]
  })
}
