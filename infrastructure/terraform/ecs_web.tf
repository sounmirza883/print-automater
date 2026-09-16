# NEXT_PUBLIC_API_BASE_URL here satisfies the standalone server's own
# runtime re-validation (packages/config's web schema, re-checked on
# every boot per 12.6's own finding) -- the value baked into the
# CLIENT bundle was already fixed at image-build time by whatever
# NEXT_PUBLIC_API_BASE_URL build ARG 12.8's own CI pipeline passed
# `docker build`, which must match this same api.<domain> URL for the
# two to agree.
resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name_prefix}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.ecs_web_cpu
  memory                   = var.ecs_web_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "web"
      image     = "${aws_ecr_repository.services["web"].repository_url}:${var.image_tag}"
      essential = true
      portMappings = [
        { containerPort = 3001, protocol = "tcp" }
      ]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "HOSTNAME", value = "0.0.0.0" },
        { name = "PORT", value = "3001" },
        { name = "NEXT_PUBLIC_API_BASE_URL", value = local.api_public_base_url },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.web.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "web"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "web" {
  name            = "${local.name_prefix}-web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs_web.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3001
  }

  depends_on = [aws_lb_listener.https]
}
