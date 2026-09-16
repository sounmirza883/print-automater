locals {
  # Real AWS S3 (not MinIO): virtual-hosted-style addressing is AWS's
  # own default/recommended approach, unlike dev's MinIO setup which
  # needs S3_FORCE_PATH_STYLE=true because it has no wildcard DNS for
  # per-bucket subdomains.
  s3_endpoint         = "https://s3.${var.aws_region}.amazonaws.com"
  api_public_base_url = "https://api.${var.domain_name}"
  web_public_base_url = "https://${var.domain_name}"
  secrets_arn         = aws_secretsmanager_secret.app.arn
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name_prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.ecs_api_cpu
  memory                   = var.ecs_api_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = "${aws_ecr_repository.services["api"].repository_url}:${var.image_tag}"
      essential = true
      portMappings = [
        { containerPort = 3000, protocol = "tcp" }
      ]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "LOG_LEVEL", value = "info" },
        { name = "PORT", value = "3000" },
        { name = "CORS_ALLOWED_ORIGINS", value = local.web_public_base_url },
        { name = "PLATFORM_FEE_MINOR", value = tostring(var.platform_fee_minor) },
        { name = "PAYMENT_PROVIDER", value = "mock" },
        { name = "API_PUBLIC_BASE_URL", value = local.api_public_base_url },
        { name = "PAYMENT_RECONCILIATION_GRACE_MINUTES", value = "5" },
        { name = "S3_ENDPOINT", value = local.s3_endpoint },
        { name = "S3_REGION", value = var.aws_region },
        { name = "S3_BUCKET", value = aws_s3_bucket.documents.bucket },
        { name = "S3_FORCE_PATH_STYLE", value = "false" },
        { name = "KMS_PROVIDER", value = "aws" },
        { name = "KMS_AWS_KEY_ID", value = aws_kms_key.documents.key_id },
      ]
      secrets = [
        { name = "DATABASE_URL", valueFrom = "${local.secrets_arn}:DATABASE_URL::" },
        { name = "REDIS_URL", valueFrom = "${local.secrets_arn}:REDIS_URL::" },
        { name = "JWT_ACCESS_SECRET", valueFrom = "${local.secrets_arn}:JWT_ACCESS_SECRET::" },
        { name = "JWT_REFRESH_SECRET", valueFrom = "${local.secrets_arn}:JWT_REFRESH_SECRET::" },
        { name = "JWT_AGENT_SECRET", valueFrom = "${local.secrets_arn}:JWT_AGENT_SECRET::" },
        { name = "MOCK_PAYMENT_WEBHOOK_SECRET", valueFrom = "${local.secrets_arn}:MOCK_PAYMENT_WEBHOOK_SECRET::" },
        { name = "S3_ACCESS_KEY_ID", valueFrom = "${local.secrets_arn}:S3_ACCESS_KEY_ID::" },
        { name = "S3_SECRET_ACCESS_KEY", valueFrom = "${local.secrets_arn}:S3_SECRET_ACCESS_KEY::" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "api" {
  name            = "${local.name_prefix}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs_api.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener_rule.api]
}
