# §2.7/§101: worker's DocumentProcessingService needs a real ClamAV to
# scan against -- dev's docker-compose runs it as its own container
# (clamav/clamav:stable), so staging does too, rather than disabling
# the check entirely (§101's own risk table explicitly allows disabling
# it for pilot if needed, but §12.8's "staging serves the golden path
# end-to-end" reads more honestly with the real scan still wired up).
# No ALB target -- reachable only via the internal service-discovery
# name worker's own CLAMAV_HOST env var points at (ecs_worker.tf).
resource "aws_ecs_task_definition" "clamav" {
  family                   = "${local.name_prefix}-clamav"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.ecs_clamav_cpu
  memory                   = var.ecs_clamav_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "clamav"
      image     = "${aws_ecr_repository.services["clamav"].repository_url}:${var.image_tag}"
      essential = true
      portMappings = [
        { containerPort = 3310, protocol = "tcp" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.clamav.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "clamav"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "clamav" {
  name            = "${local.name_prefix}-clamav"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.clamav.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs_clamav.id]
  }

  service_registries {
    registry_arn = aws_service_discovery_service.clamav.arn
  }
}
