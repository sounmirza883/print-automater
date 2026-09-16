terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # §12.7's own Done-when: "staging is provisioned entirely from code."
  # A local backend is the honest default for a repo with no S3
  # bucket/DynamoDB lock table of its own yet (bootstrapping that from
  # inside this same config is a chicken-and-egg problem) -- a real
  # team adopting this switches to an `s3` backend block here once that
  # bucket exists, without changing anything else in this directory.
}
