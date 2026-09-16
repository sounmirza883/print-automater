# §103/12.5's own "structured logs to CloudWatch": ECS's `awslogs` log
# driver (configured per-container below in ecs_*.tf) ships each
# container's stdout -- already JSON via PinoLoggerService (12.5) --
# straight into these log groups. No application code pushes logs to
# CloudWatch directly; the log driver is the only integration point.
resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name_prefix}/api"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${local.name_prefix}/worker"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.name_prefix}/web"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "clamav" {
  name              = "/ecs/${local.name_prefix}/clamav"
  retention_in_days = var.log_retention_days
}

# §103/12.5's own three named alert conditions. Each metric filter
# matches the exact `metric` field PinoLoggerService's own object-first
# convention writes into every structured log line (12.5) -- no
# application code pushes a metric directly; the filter pattern is
# the only thing that turns "a JSON log line happened" into "a real
# CloudWatch Metric with a numeric value alarms can evaluate."

# 1. Print failure rate -- agent-jobs.service.ts's reportStatus()
# logs `{"metric":"print.failed",...}` on every FAILED report (12.5).
resource "aws_cloudwatch_log_metric_filter" "print_failed" {
  name           = "${local.name_prefix}-print-failed"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.metric = \"print.failed\" }"

  metric_transformation {
    name      = "PrintFailedCount"
    namespace = "${local.name_prefix}/Metrics"
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "print_failure_rate" {
  alarm_name          = "${local.name_prefix}-print-failure-rate"
  alarm_description   = "§103: more than 3 print job failures in 5 minutes."
  namespace           = "${local.name_prefix}/Metrics"
  metric_name         = aws_cloudwatch_log_metric_filter.print_failed.metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
}

# 2. Agent disconnection -- printer-offline-sweep.processor.ts logs
# `{"metric":"agent.disconnected","count":N,...}` whenever its sweep
# marks any printer OFFLINE (12.5).
resource "aws_cloudwatch_log_metric_filter" "agent_disconnected" {
  name           = "${local.name_prefix}-agent-disconnected"
  log_group_name = aws_cloudwatch_log_group.worker.name
  pattern        = "{ $.metric = \"agent.disconnected\" }"

  metric_transformation {
    name      = "AgentDisconnectedCount"
    namespace = "${local.name_prefix}/Metrics"
    value     = "$.count"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "agent_disconnection" {
  alarm_name          = "${local.name_prefix}-agent-disconnection"
  alarm_description   = "§103: any agent/printer marked OFFLINE by the offline sweep."
  namespace           = "${local.name_prefix}/Metrics"
  metric_name         = aws_cloudwatch_log_metric_filter.agent_disconnected.metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
}

# 3. Queue backlog -- QueueMetricsProcessor (12.5) logs
# `{"metric":"queue.depth","queue":"...","waiting":N,...}` every 60s
# for all 7 queues. `queue.waiting` is dot-notation into that field --
# CloudWatch Logs metric filter patterns can select nested JSON fields
# this way without needing a separate filter per queue name.
resource "aws_cloudwatch_log_metric_filter" "queue_backlog" {
  name           = "${local.name_prefix}-queue-backlog"
  log_group_name = aws_cloudwatch_log_group.worker.name
  pattern        = "{ $.metric = \"queue.depth\" }"

  # Deliberately no per-queue `dimensions` here: a dimensioned metric
  # only ever receives data points under that exact dimension value, so
  # a single dimensionless alarm below would never fire against it.
  # Every one of the 7 queues' own `waiting` counts (12.5's
  # QueueMetricsProcessor) publishes into this SAME undimensioned
  # metric instead -- the alarm's own `Maximum` statistic over the
  # period is then "the worst single queue's backlog in this window,"
  # which is exactly the plan's own single "queue backlog" alert
  # condition, not a per-queue one.
  metric_transformation {
    name      = "QueueWaitingCount"
    namespace = "${local.name_prefix}/Metrics"
    value     = "$.waiting"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "queue_backlog" {
  alarm_name          = "${local.name_prefix}-queue-backlog"
  alarm_description   = "§103: some queue's own waiting-job count exceeded 100 across two consecutive 5-minute windows."
  namespace           = "${local.name_prefix}/Metrics"
  metric_name         = aws_cloudwatch_log_metric_filter.queue_backlog.metric_transformation[0].name
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 100
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
}
