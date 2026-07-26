# aide infra — Cloudflare Access

公開 URL（Pages · Workers）を Cloudflare Access で保護する。

## 対象

| App | Domain |
| --- | --- |
| `aide-web` | `aide-1ll.pages.dev` + `*.aide-1ll.pages.dev`（preview） |
| `aide-api` | `aide-api.keitaro-cryptocurrency.workers.dev` |

許可メール（デフォルト）: `keitaro.cryptocurrency@gmail.com`（変数 `allowed_email`）

## 必要な API トークン権限

ローカルは User API Token（`~/.config/cloudflare/terraform.fish`）。

| 権限 | リソース |
| --- | --- |
| Account · Access: Apps and Policies · Edit | 対象アカウント |
| Account · Access: Service Tokens · Edit | 対象アカウント（import 用 Service Token） |

詳細: [keitaro-yamaguchi/infra/secrets.example/cloudflare/README.md](https://github.com/keitaroooo/keitaro-yamaguchi/blob/main/infra/secrets.example/cloudflare/README.md)

## Apply

```fish
cd ~/ghq/github.com/keitaroooo/aide
./infra/apply.fish
```

手動:

```fish
source ~/.config/cloudflare/terraform.fish
cd infra/terraform/cloudflare
terraform init
terraform apply
```

非対話:

```fish
source ~/.config/cloudflare/terraform.fish
cd infra/terraform/cloudflare
terraform init
terraform apply -auto-approve
```

## 検証

未認証の `curl` が Access ログインへ跳ねることを確認:

```bash
curl -sI -H 'Accept: text/html' https://aide-1ll.pages.dev | rg -i '^(HTTP/|location:)'
curl -sI -H 'Accept: text/html' https://aide-api.keitaro-cryptocurrency.workers.dev | rg -i '^(HTTP/|location:)'
```

`HTTP/2 302` と `Location: https://...cloudflareaccess.com/cdn-cgi/access/login/...` なら OK。

## Service Token（import スクリプト）

`aide-api` には Service Auth ポリシー付き。自動化は次のヘッダを付ける:

| Header | Env（推奨） |
| --- | --- |
| `CF-Access-Client-Id` | `CF_ACCESS_CLIENT_ID` |
| `CF-Access-Client-Secret` | `CF_ACCESS_CLIENT_SECRET` |

値の取り出し（secret は画面に出さない）:

```fish
source ~/.config/cloudflare/terraform.fish
cd infra/terraform/cloudflare
terraform output -raw aide_import_service_token_client_id
terraform output -raw aide_import_service_token_client_secret
```

ローカル手渡し用に apply 後 `infra/terraform/cloudflare/.access-service-token.env`（gitignored）へ書くこともある。Python `urllib` 例:

```python
import os
import urllib.request

req = urllib.request.Request(
    url,
    headers={
        "CF-Access-Client-Id": os.environ["CF_ACCESS_CLIENT_ID"],
        "CF-Access-Client-Secret": os.environ["CF_ACCESS_CLIENT_SECRET"],
        "Content-Type": "application/json",
    },
    data=body,
    method="POST",
)
```
