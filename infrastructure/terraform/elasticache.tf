resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name_prefix}-redis"
  subnet_ids = aws_subnet.private[*].id
}

# Redis 7, matching §60/the locked-decisions table. A single
# cache.t4g.micro node (no replication group/cluster mode) -- §12.8's
# own "staging serves the golden path" scope needs Redis reachable,
# not HA; BullMQ/rate-limiting/order-locking would all need
# reconnect-handling review before this could safely become multi-node
# anyway, which is out of this sub-phase's own scope.
resource "aws_elasticache_cluster" "main" {
  cluster_id           = "${local.name_prefix}-redis"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.redis_node_type
  num_cache_nodes      = 1
  port                 = 6379
  parameter_group_name = "default.redis7"

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  tags = { Name = "${local.name_prefix}-redis" }
}
