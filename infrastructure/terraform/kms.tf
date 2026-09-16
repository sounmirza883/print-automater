# §62's prod path: AwsKmsProvider (packages/backend-shared/src/kms/
# aws-kms.provider.ts) calls GenerateDataKey/Encrypt/Decrypt against
# this key's id via the ECS task role's default AWS SDK credential
# chain -- no access key/secret needed for KMS, unlike S3 (see s3.tf).
resource "aws_kms_key" "documents" {
  description             = "${local.name_prefix} document envelope-encryption key (§62)"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "documents" {
  name          = "alias/${local.name_prefix}-documents"
  target_key_id = aws_kms_key.documents.key_id
}

resource "aws_kms_key_policy" "documents" {
  key_id = aws_kms_key.documents.id
  policy = data.aws_iam_policy_document.kms_key_policy.json
}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "kms_key_policy" {
  # The account's own root/IAM policies still govern who can manage
  # this key (standard AWS default-policy escape hatch) -- this
  # statement alone would otherwise lock out the account itself.
  statement {
    sid    = "EnableIamUserPermissions"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  statement {
    sid    = "AllowEcsTaskRoleUse"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.ecs_task.arn]
    }
    actions = [
      "kms:GenerateDataKey",
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:DescribeKey",
    ]
    resources = ["*"]
  }
}
