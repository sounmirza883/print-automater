resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name_prefix}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.ecs_worker_cpu
  memory                   = var.ecs_worker_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = "${aws_ecr_repository.services["worker"].repository_url}:${var.image_tag}"
      essential = true
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "LOG_LEVEL", value = "info" },
        { name = "S3_ENDPOINT", value = local.s3_endpoint },
        { name = "S3_REGION", value = var.aws_region },
        { name = "S3_BUCKET", value = aws_s3_bucket.documents.bucket },
        { name = "S3_FORCE_PATH_STYLE", value = "false" },
        { name = "KMS_PROVIDER", value = "aws" },
        { name = "KMS_AWS_KEY_ID", value = aws_kms_key.documents.key_id },
        # §2.7/§101: dev's docker-compose runs a real ClamAV container by
        # default (feature-flagged, on by default per the risk table) --
        # this points at the internal ClamAV task's own stable service-
        # discovery name (ecs_clamav.tf), not off by default in staging.
        { name = "CLAMAV_ENABLED", value = "true" },
        { name = "CLAMAV_HOST", value = "clamav.${local.name_prefix}.internal" },
        { name = "CLAMAV_PORT", value = "3310" },
        { name = "EMAIL_TRANSPORT", value = "ses" },
        { name = "EMAIL_FROM_ADDRESS", value = "no-reply@${var.domain_name}" },
        { name = "ORDER_PAYMENT_PENDING_TTL_MINUTES", value = "30" },
        { name = "PRINT_JOB_TIMEOUT_MINUTES", value = "10" },
        { name = "DOCUMENT_RETENTION_DAYS", value = "30" },
      ]
      secrets = [
        { name = "DATABASE_URL", valueFrom = "${local.secrets_arn}:DATABASE_URL::" },
        { name = "REDIS_URL", valueFrom = "${local.secrets_arn}:REDIS_URL::" },
        { name = "S3_ACCESS_KEY_ID", valueFrom = "${local.secrets_arn}:S3_ACCESS_KEY_ID::" },
        { name = "S3_SECRET_ACCESS_KEY", valueFrom = "${local.secrets_arn}:S3_SECRET_ACCESS_KEY::" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "worker" {
  name            = "${local.name_prefix}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs_worker.id]
  }

  # No load_balancer block -- worker has no listening port (§2.6) and
  # is never an ALB target, matching security_groups.tf's own
  # egress-only worker security group.
  depends_on = [aws_ecs_service.clamav]
}
