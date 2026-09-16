output "alb_dns_name" {
  description = "ALB's own AWS-assigned DNS name -- point var.domain_name's and api.var.domain_name's DNS records here (CNAME/ALIAS) once the stack is up."
  value       = aws_lb.main.dns_name
}

output "ecr_repository_urls" {
  description = "Push targets for §12.8's own deploy pipeline (api/worker/web) and the upstream ClamAV mirror."
  value       = { for name, repo in aws_ecr_repository.services : name => repo.repository_url }
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "rds_endpoint" {
  description = "RDS instance endpoint (host:port) -- not the full DATABASE_URL, which includes the generated password and lives only in Secrets Manager (§102)."
  value       = aws_db_instance.main.endpoint
}

output "redis_endpoint" {
  value = aws_elasticache_cluster.main.cache_nodes[0].address
}

output "documents_bucket_name" {
  value = aws_s3_bucket.documents.bucket
}

output "kms_key_id" {
  value = aws_kms_key.documents.key_id
}

output "app_secrets_arn" {
  description = "Secrets Manager secret holding every generated credential (§102) -- DATABASE_URL, REDIS_URL, JWT secrets, S3 access keys, the mock payment webhook secret."
  value       = aws_secretsmanager_secret.app.arn
}

output "acm_certificate_validation_records" {
  description = "DNS records to add at your domain registrar/DNS host to validate the ACM certificate -- `terraform apply` blocks here until these exist and propagate."
  value = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  }
}

output "ses_dkim_tokens" {
  description = "SES DKIM CNAME records -- add these (and the domain identity's own verification TXT record, ses_verification_token below) before real email sending works."
  value       = aws_ses_domain_dkim.main.dkim_tokens
}

output "ses_verification_token" {
  value = aws_ses_domain_identity.main.verification_token
}
