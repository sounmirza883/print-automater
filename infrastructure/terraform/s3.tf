resource "random_id" "bucket_suffix" {
  byte_length = 4
}

# §61: real S3, replacing dev's MinIO. Bucket name includes a random
# suffix -- S3 bucket names are globally unique across all of AWS, not
# just this account, so a deterministic name risks colliding with
# someone else's bucket on a fresh deploy.
resource "aws_s3_bucket" "documents" {
  bucket = "${local.name_prefix}-documents-${random_id.bucket_suffix.hex}"
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

# §61/§62: server-side encryption at the bucket level, using the same
# customer-managed key documents are already envelope-encrypted with
# app-side before upload (packages/backend-shared's CryptoService,
# 2.3) -- belt and suspenders, not a substitute for the app-level
# encryption itself.
resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.documents.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# §11.5's own retention worker deletes documents at the application
# layer once past the configurable retention window -- this lifecycle
# rule is a second, independent backstop specifically for the
# `quarantine/` prefix (2.1/2.7): an object that failed to be deleted
# by DocumentProcessingService's own `finally` block (§68, "the
# quarantine object is deleted on every path, success or failure") on
# some unhandled crash path still can't linger forever.
resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    id     = "expire-orphaned-quarantine-objects"
    status = "Enabled"
    filter {
      prefix = "quarantine/"
    }
    expiration {
      days = 1
    }
  }

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = ["https://${var.domain_name}"]
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}

# §61/2.1: storage.service.ts's S3Client is always constructed with
# explicit `credentials: { accessKeyId, secretAccessKey }` (confirmed
# by reading packages/backend-shared/src/storage/storage.module.ts),
# never the ECS task role's own default credential chain the way
# KMS/SES both do -- so a dedicated, least-privilege IAM user (not the
# task role) is what api/worker actually authenticate to S3 with.
# Scoped to only this bucket, nothing else in the account.
resource "aws_iam_user" "s3_documents" {
  name = "${local.name_prefix}-s3-documents"
}

resource "aws_iam_access_key" "s3_documents" {
  user = aws_iam_user.s3_documents.name
}

data "aws_iam_policy_document" "s3_documents_access" {
  statement {
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.documents.arn}/*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.documents.arn]
  }
}

resource "aws_iam_user_policy" "s3_documents" {
  name   = "${local.name_prefix}-s3-documents-access"
  user   = aws_iam_user.s3_documents.name
  policy = data.aws_iam_policy_document.s3_documents_access.json
}
