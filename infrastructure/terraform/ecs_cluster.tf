resource "aws_ecs_cluster" "main" {
  name = local.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# Private DNS namespace for service-to-service calls that aren't
# through the ALB -- specifically worker reaching the internal ClamAV
# task at a stable name instead of a Fargate task's own
# ephemeral-per-deploy IP.
resource "aws_service_discovery_private_dns_namespace" "main" {
  name = "${local.name_prefix}.internal"
  vpc  = aws_vpc.main.id
}

resource "aws_service_discovery_service" "clamav" {
  name = "clamav"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}
