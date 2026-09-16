# One repo per 12.6 Dockerfile (api, worker, web) plus the third-party
# ClamAV image mirrored into this account's own ECR -- an ECS Fargate
# task can't pull directly from Docker Hub without NAT-routed internet
# access hitting Docker Hub's own (frequently rate-limited) anonymous
# pull path; mirroring it here is the standard fix, matching how every
# other image in this stack is already pulled through this account's
# own ECR.
locals {
  ecr_repo_names = ["api", "worker", "web", "clamav"]
}

resource "aws_ecr_repository" "services" {
  for_each = toset(local.ecr_repo_names)

  name                 = "${local.name_prefix}-${each.key}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "services" {
  for_each   = aws_ecr_repository.services
  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the last 20 images, expire the rest"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 20
        }
        action = { type = "expire" }
      }
    ]
  })
}
