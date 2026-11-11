# PunchPay 2.0 Setup Guide

## 1. Prerequisites
- **Node.js 22+** (uses built-in `node:sqlite` for zero-config local persistence)
- **Google Chrome** (for Playwright E2E browser tests)
- **PayPal Developer Sandbox Accounts**:
  - One **Sandbox Business** account (Contractor / Payee) -> get REST App `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and Merchant ID (`PAYPAL_MERCHANT_ID`).
  - One **Sandbox Personal** account (Homeowner / Payer) -> used to log in and approve orders in the PayPal checkout popup.
- **AI Vision API Key**: either `GEMINI_API_KEY` (Google AI Studio) or `ANTHROPIC_API_KEY` (Anthropic Console).

## 2. Install & Configure `.env.local`
```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` (never commit `.env.local`):
- `PAYPAL_CLIENT_ID`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID`
- Optional webhook verification: `PAYPAL_WEBHOOK_ID` (point sandbox webhook to `https://<your-host>/api/webhooks/paypal`)
- `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`)
- Optional Supabase persistence: `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

## 3. Database Migration (Supabase — Optional)
If using Supabase instead of the built-in local SQLite persistence:
1. Create a dedicated Supabase project.
2. Apply `supabase/migrations/20261111000000_punchpay_v2.sql` in the SQL Editor (or via `supabase db push`).
3. Confirm private storage bucket `punchpay-evidence` is created with `public = false`.

## 4. Run Locally & Verify
```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run dev
```
Open `http://localhost:3000`.

## 5. PayPal Milestone A CLI Proof (Optional Standalone Verification)
```bash
npm run sandbox:create
# Approve both printed sandbox URLs in a browser using your sandbox Personal account
npm run sandbox:settle
npm run sandbox:verify
```
