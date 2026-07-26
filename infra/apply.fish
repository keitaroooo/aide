#!/usr/bin/env fish
# ~/.config/cloudflare/terraform.fish からトークンを読み込んで Terraform apply する

set script_dir (dirname (status --current-filename))
source "$script_dir/load_tokens.fish"

cd "$script_dir/terraform/cloudflare"
terraform init
terraform apply $argv
