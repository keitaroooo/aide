#!/usr/bin/env fish
# Cloudflare Terraform 用 TF_VAR（$HOME/.config/cloudflare/terraform.fish）

set -l secret "$HOME/.config/cloudflare/terraform.fish"
if not test -f $secret
    echo "error: $secret がありません" >&2
    echo "  手順: keitaro-yamaguchi/infra/secrets.example/cloudflare/README.md" >&2
    exit 1
end
source $secret
echo "✓ Cloudflare TF_VAR をセットしました ($secret)"
