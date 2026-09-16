resource "aws_lb" "main" {
  name               = "${local.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
}

# DNS-validated -- var.domain_name must be a real, resolvable domain
# whose zone this account (or whoever owns it) can add the validation
# CNAME to; `terraform apply` blocks on aws_acm_certificate_validation
# below until that record exists and propagates, which is a manual
# step outside Terraform's own control unless the zone is also managed
# here (out of this config's scope -- the domain is assumed
# externally owned, e.g. bought through a different registrar).
resource "aws_acm_certificate" "main" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "main" {
  certificate_arn = aws_acm_certificate.main.arn
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name_prefix}-api"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip" # Fargate awsvpc mode has no EC2 instance to register -- each task's own ENI IP is the target.

  health_check {
    path                = "/v1/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    matcher             = "200"
  }

  deregistration_delay = 30
}

resource "aws_lb_target_group" "web" {
  name        = "${local.name_prefix}-web"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    matcher             = "200"
  }

  deregistration_delay = 30
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# customer-web is the default target (what a browser hitting the bare
# domain expects, §12 "landing page stating plainly what the product
# does"); api.<domain> is routed by host header, matching
# API_PUBLIC_BASE_URL/NEXT_PUBLIC_API_BASE_URL's own expected shape
# (a separate subdomain, not a path prefix -- customer-web's own
# middleware and cookie-domain assumptions are simplest against two
# distinct hosts, not one host split by path).
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.main.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    host_header {
      values = ["api.${var.domain_name}"]
    }
  }
}
