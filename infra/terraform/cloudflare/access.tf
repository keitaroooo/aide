# Cloudflare Access (Zero Trust) — aide web + API
# Reusable allow policy + applications with policies = [{ id, precedence }]

resource "cloudflare_zero_trust_access_policy" "aide_allow_email" {
  account_id = var.cloudflare_account_id
  name       = "aide-allow-email"
  decision   = "allow"

  include = [{
    email = {
      email = var.allowed_email
    }
  }]
}

# Automation (keitaro-yamaguchi import scripts → aide-api)
resource "cloudflare_zero_trust_access_service_token" "aide_import" {
  account_id = var.cloudflare_account_id
  name       = "aide-import"
  duration   = "8760h"

  lifecycle {
    create_before_destroy = true
  }
}

resource "cloudflare_zero_trust_access_policy" "aide_service_auth" {
  account_id = var.cloudflare_account_id
  name       = "aide-service-auth"
  decision   = "non_identity"

  include = [{
    service_token = {
      token_id = cloudflare_zero_trust_access_service_token.aide_import.id
    }
  }]
}

resource "cloudflare_zero_trust_access_application" "aide_web" {
  account_id       = var.cloudflare_account_id
  name             = "aide-web"
  type             = "self_hosted"
  domain           = var.pages_domain
  session_duration = var.session_duration

  # production + preview (*.aide-1ll.pages.dev)
  destinations = [
    {
      type = "public"
      uri  = var.pages_domain
    },
    {
      type = "public"
      uri  = "*.${var.pages_domain}"
    },
  ]

  policies = [{
    id         = cloudflare_zero_trust_access_policy.aide_allow_email.id
    precedence = 1
  }]
}

resource "cloudflare_zero_trust_access_application" "aide_api" {
  account_id       = var.cloudflare_account_id
  name             = "aide-api"
  type             = "self_hosted"
  domain           = var.api_domain
  session_duration = var.session_duration

  destinations = [{
    type = "public"
    uri  = var.api_domain
  }]

  # email OTP (browser) + service token (import scripts)
  policies = [
    {
      id         = cloudflare_zero_trust_access_policy.aide_service_auth.id
      precedence = 1
    },
    {
      id         = cloudflare_zero_trust_access_policy.aide_allow_email.id
      precedence = 2
    },
  ]
}
