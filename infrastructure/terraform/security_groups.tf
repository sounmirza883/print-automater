resource "aws_security_group" "alb" {
  name_prefix = "${local.name_prefix}-alb-"
  description = "Internet-facing ALB -- 80/443 from anywhere, redirects 80 to 443."
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP (redirected to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-alb-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "ecs_api" {
  name_prefix = "${local.name_prefix}-ecs-api-"
  description = "api Fargate tasks -- inbound only from the ALB, on §1.1's own port 3000."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "From ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-ecs-api-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "ecs_web" {
  name_prefix = "${local.name_prefix}-ecs-web-"
  description = "customer-web Fargate tasks -- inbound only from the ALB, on §3.3's own port 3001."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "From ALB"
    from_port       = 3001
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-ecs-web-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

# worker has no listening port at all (§2.6: BullMQ consumer only) --
# no ingress rule, egress-only, matching 12.6's own worker.Dockerfile
# healthcheck reasoning (nothing to expose, only outbound Redis/
# Postgres/S3/KMS/SES/ClamAV calls).
resource "aws_security_group" "ecs_worker" {
  name_prefix = "${local.name_prefix}-ecs-worker-"
  description = "worker Fargate tasks -- no ingress, outbound to RDS/ElastiCache/S3/KMS/SES/ClamAV only."
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-ecs-worker-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "ecs_clamav" {
  name_prefix = "${local.name_prefix}-ecs-clamav-"
  description = "ClamAV Fargate task -- inbound only from worker, on its own 3310 (matching the dev stack's own clamav service)."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "From worker"
    from_port       = 3310
    to_port         = 3310
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_worker.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-ecs-clamav-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "rds" {
  name_prefix = "${local.name_prefix}-rds-"
  description = "RDS Postgres -- inbound only from api/worker Fargate tasks."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "From api"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_api.id]
  }

  ingress {
    description     = "From worker"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_worker.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-rds-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "redis" {
  name_prefix = "${local.name_prefix}-redis-"
  description = "ElastiCache Redis -- inbound only from api/worker Fargate tasks."
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "From api"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_api.id]
  }

  ingress {
    description     = "From worker"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_worker.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-redis-sg" }

  lifecycle {
    create_before_destroy = true
  }
}
