variable "cloudflare_api_token" {
  type        = string
  sensitive   = true
  description = "Cloudflare API token (Access: Apps and Policies Edit)"
}

variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare Account ID"
  default     = "45d968875507d72037e99ec939b112c1"
}

variable "allowed_email" {
  type        = string
  description = "Email allowed through Cloudflare Access (OTP login)"
  default     = "keitaro.cryptocurrency@gmail.com"
}

variable "session_duration" {
  type        = string
  description = "Access session duration (e.g. 168h)"
  default     = "168h"
}

variable "pages_domain" {
  type        = string
  description = "Pages production hostname (without scheme)"
  default     = "aide-1ll.pages.dev"
}

variable "api_domain" {
  type        = string
  description = "Workers API hostname (without scheme)"
  default     = "aide-api.keitaro-cryptocurrency.workers.dev"
}
