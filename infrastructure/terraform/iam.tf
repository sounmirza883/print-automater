# Two distinct ECS IAM roles, not one -- the execution role is what
# the ECS agent itself uses to pull images and start the task (image
# pull from ECR, writing to CloudWatch Logs, reading secrets to inject
# as env vars); the task role is what the *application code* assumes
# once running (KMS, SES). Conflating them would let application code
# pull arbitrary images or read secrets it has no business reading.

data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${local.name_prefix}-ecs-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_task_execution_secrets" {
  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn]
  }
}

resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  name   = "${local.name_prefix}-ecs-task-execution-secrets"
  role   = aws_iam_role.ecs_task_execution.id
  policy = data.aws_iam_policy_document.ecs_task_execution_secrets.json
}

resource "aws_iam_role" "ecs_task" {
  name               = "${local.name_prefix}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

# §78/7.2: EmailModule's SesEmailTransport (`new SESv2Client({ region
# })`, no explicit credentials -- confirmed by reading
# packages/backend-shared/src/notifications/email.module.ts) relies on
# exactly this role via the default AWS SDK credential chain, the same
# pattern KMS already uses and S3 deliberately doesn't (see s3.tf).
data "aws_iam_policy_document" "ecs_task_ses" {
  statement {
    effect    = "Allow"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ecs_task_ses" {
  name   = "${local.name_prefix}-ecs-task-ses"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task_ses.json
}
