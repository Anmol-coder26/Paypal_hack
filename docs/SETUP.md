# PunchPay 2.1 Setup & Sandbox Verification Guide

## 1. Prerequisites
- **Node.js 22+** (uses built-in `node:sqlite` for zero-config local persistence)
- **Microsoft Edge or Google Chrome** (for Playwright browser E2E tests)
- **PayPal Developer Sandbox Accounts** ([developer.paypal.com](https://developer.paypal.com/dashboard/)):
  - **Sandbox Business account (Contractor / Payee):** Copy REST App `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and the Business account Merchant ID (`PAYPAL_MERCHANT_ID`).
  - **Sandbox Personal account (Homeowner / Payer):** Used in the browser PayPal popup to approve orders as buyer.
- **Google Gemini API Key** ([Google AI Studio](https://aistudio.google.com/apikey)) for live `gemini-3.5-flash` vision inspections (or local Ollama `qwen2.5vl:3b` for offline local vision; Guided Checklist always works offline).

## 2. Install & Configure `.env.local`
```bash
npm install
cp .env.example .env.local
```

Configure `.env.local` (never commit `.env.local` or `.data/`):
```ini
# Set paypal_sandbox once Sandbox keys are populated (simulation runs offline with no money moved)
PAYMENT_MODE=paypal_sandbox
PAYPAL_CLIENT_ID=your_sandbox_rest_app_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_rest_app_secret
NEXT_PUBLIC_PAYPAL_CLIENT_ID=your_sandbox_rest_app_client_id
PAYPAL_MERCHANT_ID=your_sandbox_business_merchant_id
# Optional: configure after setting Sandbox webhook -> https://<your-host>/api/webhooks/paypal
PAYPAL_WEBHOOK_ID=

NEXT_PUBLIC_APP_URL=http://localhost:3000
SESSION_SECRET=replace_with_64_char_random_hex
PUNCHPAY_CREDENTIAL_ENCRYPTION_KEY=replace_with_32_char_secret

# AI Vision (Admin Settings UI vault is preferred; or set GEMINI_API_KEY here)
GEMINI_MODEL=gemini-3.5-flash
GEMINI_API_KEY=
```

> **Security Note:** Never paste live API keys into chat, screenshots, or Git commits. Store your Gemini key through **Admin Workspace -> `/settings`** (stored encrypted with AES-256-GCM in `.data/punchpay.db` using `.data/.vault/credential-master.key`) or locally inside `.env.local`.

## 3. Optional Supabase Migration
By default, PunchPay persists locally in `.data/punchpay.db` + `.data/evidence/`. To use Supabase instead:
1. Create a dedicated Supabase project.
2. Apply `supabase/migrations/20261111000000_punchpay_v2.sql` and `supabase/migrations/20261112120000_punchpay_v22_ai_vault.sql`.
3. Set `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

## 4. Verify & Run Locally
```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run dev
```
Open `http://localhost:3000`.

## 5. Standalone PayPal Sandbox Verification (`GET` Verified)
Once PayPal Sandbox credentials are in `.env.local`, verify two independent authorizations, `$30.00` capture, `$20.00` void, merchant ID, USD currency, and transaction IDs directly via PayPal `GET` APIs:
```bash
npm run sandbox:create
# Open both printed approval URLs and sign in with your Sandbox Personal buyer account
npm run sandbox:settle
npm run sandbox:verify
```
