# §78/7.2: SesEmailTransport's prod path. Only the domain identity and
# DKIM tokens are created here -- actually adding the resulting DNS
# records (output below) and requesting production sending access
# (SES accounts start in a sending-limited sandbox) are manual steps
# outside Terraform's own control, the same DNS-ownership caveat the
# ACM certificate above has.
resource "aws_ses_domain_identity" "main" {
  domain = var.domain_name
}

resource "aws_ses_domain_dkim" "main" {
  domain = aws_ses_domain_identity.main.domain
}

resource "aws_ses_domain_mail_from" "main" {
  domain           = aws_ses_domain_identity.main.domain
  mail_from_domain = "mail.${var.domain_name}"
}
