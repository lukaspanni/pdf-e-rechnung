# PDF E-Rechnung

Technical foundation for an application that processes and eventually creates ZUGFeRD / Factur-X invoices.

## Current structure

```text
apps/web
packages/invoice-core
packages/pdf-core
packages/invoice-extraction
packages/api-contract
packages/zugferd-adapter
packages/einvoice-service
apps/api-azure
```

## Portability model

```text
Application Core
      │
      ▼
Cloud Abstraction Layer
      │
  ┌───┴────┐
  │        │
Azure   future AWS /
        Workers / other
```

`@app/einvoice-service` owns the ZUGFeRD use case and depends only on the small
`CloudPlatform` interface (logger and clock). `apps/api-azure` is the first
deployment adapter; Azure Functions and its HTTP types stay in that app. The
Factur-X library is isolated in `@app/zugferd-adapter`. Replacing Azure later
means implementing a new platform adapter, not changing invoice generation.

Generation is stateless: verified invoice plus source PDF enter memory, a
validated EN 16931 PDF is returned. The Flex Consumption Terraform config uses
512 MB instances and configures no Always Ready instances. Its storage account
is limited to Functions deployment/runtime infrastructure, not invoice data;
generated invoice documents are never persisted.

The same multipart endpoint also runs as a plain Node HTTP server, without Azure
Functions Core Tools or Azure resources. Start `pnpm dev:api` in one terminal
and `pnpm dev` in another. The API listens on `http://localhost:7071` by
default; Vite proxies `/api` to it. Set `PORT` to override the API port, or set
`VITE_EINVOICE_API_BASE_URL` to use a different API origin.

## Desktop app

The Tauri desktop wrapper serves the same web app and starts the local HTTP
backend as a standalone Bun sidecar. Bun compiles the backend and runtime into
a target-specific executable, including for cross-compilation. Bun and Rust are
required.

```bash
pnpm desktop       # development
pnpm desktop:build # release bundle
```

Press F12 in the desktop app to open WebView DevTools.

## Azure infrastructure with Terraform / OpenTofu

The Azure app infrastructure lives in `apps/api-azure/infra/terraform`. It uses
the AzureRM Flex Consumption resource (`azurerm_function_app_flex_consumption`)
and remains compatible with OpenTofu. To initialize remote state, first create
a dedicated state storage account/container outside this stack, then copy
`backend.tf.example` to `backend.hcl` and initialize with:

```bash
cd apps/api-azure/infra/terraform
cp backend.tf.example backend.hcl
tofu init -backend-config=backend.hcl
cp terraform.tfvars.example terraform.tfvars
tofu plan
```

Keep state storage separate from this stack's runtime/deployment storage so
state initialization does not depend on resources managed by that same state.
Use Azure authentication supported by the AzureRM provider (for example Azure
CLI locally or workload identity in CI); backend state access uses Entra ID
(`use_azuread_auth = true`), no account keys in backend config.
Terraform CLI can use the same `terraform` commands in place of `tofu`.

The API project uses the Azure Functions Core Tools v4 programming model and
the official Node.js v4 registration API. Scaffold/runtime commands:

```bash
cd apps/api-azure
func init . --worker-runtime node --language typescript
func new --template "HTTP trigger" --name GenerateEInvoice
```

`func init`/`func new` are the supported CLI scaffolding commands. The checked-in
app uses that model's code registration and does not include generated per-
function `function.json` files.

Set `VITE_EINVOICE_API_BASE_URL` to the API origin for the web client.
The endpoint is `POST /api/einvoices/generate` using multipart fields `pdf` and
`invoice`; successful responses are `application/pdf`.

## Development

```bash
pnpm install
pnpm dev
pnpm build
pnpm check
```
