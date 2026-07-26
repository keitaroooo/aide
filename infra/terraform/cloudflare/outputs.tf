output "access_policy_id" {
  description = "Reusable Access policy ID (email allow)"
  value       = cloudflare_zero_trust_access_policy.aide_allow_email.id
}

output "aide_web_application_id" {
  description = "Access application ID for Pages"
  value       = cloudflare_zero_trust_access_application.aide_web.id
}

output "aide_api_application_id" {
  description = "Access application ID for Workers API"
  value       = cloudflare_zero_trust_access_application.aide_api.id
}

output "aide_web_aud" {
  description = "Access audience tag for aide-web"
  value       = cloudflare_zero_trust_access_application.aide_web.aud
}

output "aide_api_aud" {
  description = "Access audience tag for aide-api"
  value       = cloudflare_zero_trust_access_application.aide_api.aud
}

output "aide_import_service_token_id" {
  description = "Access service token UUID (aide-import)"
  value       = cloudflare_zero_trust_access_service_token.aide_import.id
}

output "aide_import_service_token_client_id" {
  description = "CF-Access-Client-Id for import scripts"
  value       = cloudflare_zero_trust_access_service_token.aide_import.client_id
}

output "aide_import_service_token_client_secret" {
  description = "CF-Access-Client-Secret for import scripts (sensitive)"
  value       = cloudflare_zero_trust_access_service_token.aide_import.client_secret
  sensitive   = true
}
