variable "project_name" {
  description = "Short name used as a prefix for every resource this config creates."
  type        = string
  default     = "print-automated"
}

variable "environment" {
  description = "Deployment environment name (staging, production, ...). §12.8's own scope is staging."
  type        = string
  default     = "staging"
}

variable "aws_region" {
  description = "AWS region every resource is created in."
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zone_count" {
  description = "Number of AZs to spread public/private subnets across. 2 is the minimum for an ALB and RDS/ElastiCache subnet groups; not more for staging cost reasons."
  type        = number
  default     = 2
}

variable "db_name" {
  description = "Postgres database name."
  type        = string
  default     = "print_automated"
}

variable "db_username" {
  description = "Postgres master username."
  type        = string
  default     = "print_automated"
}

variable "db_instance_class" {
  description = "RDS instance class. db.t4g.micro is staging-sized, not production-sized."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage_gb" {
  description = "RDS allocated storage in GB."
  type        = number
  default     = 20
}

variable "db_multi_az" {
  description = "Whether RDS runs Multi-AZ. Off by default -- staging cost/simplicity per §12.8's own scope; a real production deploy overrides this to true."
  type        = bool
  default     = false
}

variable "redis_node_type" {
  description = "ElastiCache node type. cache.t4g.micro is staging-sized."
  type        = string
  default     = "cache.t4g.micro"
}

variable "domain_name" {
  description = "Base domain this deploy is reachable at (e.g. staging.print-automated.example). Used for the ACM certificate, ALB listener, SES domain identity, and derived service URLs. Must be a real domain you control -- ACM/SES both require DNS validation."
  type        = string
}

variable "ecs_api_cpu" {
  description = "Fargate CPU units for the api service (1024 = 1 vCPU)."
  type        = number
  default     = 512
}

variable "ecs_api_memory" {
  description = "Fargate memory (MiB) for the api service."
  type        = number
  default     = 1024
}

variable "ecs_worker_cpu" {
  description = "Fargate CPU units for the worker service."
  type        = number
  default     = 512
}

variable "ecs_worker_memory" {
  description = "Fargate memory (MiB) for the worker service."
  type        = number
  default     = 1024
}

variable "ecs_web_cpu" {
  description = "Fargate CPU units for the web (customer-web) service."
  type        = number
  default     = 256
}

variable "ecs_web_memory" {
  description = "Fargate memory (MiB) for the web service."
  type        = number
  default     = 512
}

variable "ecs_clamav_cpu" {
  description = "Fargate CPU units for the internal ClamAV service worker's document pipeline (§2.7) scans against."
  type        = number
  default     = 512
}

variable "ecs_clamav_memory" {
  description = "Fargate memory (MiB) for the ClamAV service -- its virus database alone needs headroom beyond the CPU-implied default."
  type        = number
  default     = 2048
}

variable "image_tag" {
  description = "Image tag ECS task definitions are pinned to. §12.8's deploy pipeline pushes a new tag to ECR and updates this (e.g. via -var or a CI-generated tfvars file), not `latest` -- a moving tag defeats `terraform plan`'s own ability to show what's actually changing."
  type        = string
  default     = "initial"
}

variable "platform_fee_minor" {
  description = "§19's platform fee, in minor currency units, applied on top of every shop's own pricing."
  type        = number
  default     = 0
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for every service's log group."
  type        = number
  default     = 30
}

variable "alarm_sns_topic_arn" {
  description = "SNS topic ARN the §103/12.5 CloudWatch alarms (print failure rate, agent disconnection, queue backlog) publish to. Empty by default -- alarms still exist and evaluate, they just have nowhere to notify until a real on-call channel (PagerDuty/Slack/email subscription) is wired to an SNS topic and its ARN passed here."
  type        = string
  default     = ""
}
