# PunchPay 2.0

**Every fix has its own payment. Every payment has a reason.**

PunchPay is an AI-assisted home repair verification and PayPal payment settlement platform built for the PayPal AI Hackathon 2026. Homeowners create projects with independent repair tasks, authorize separate PayPal Orders v2 holds (`AUTHORIZE`), contractors upload sanitized before-and-after photographic evidence, multimodal AI generates structured inspection reports against agreed criteria, and homeowners retain final authority to capture accepted work or void rejected authorizations via PayPal Payments v2.

> **Disclaimer:** PunchPay uses **PayPal Sandbox** temporary payment authorizations (up to 29-day validity with an initial 3-day honor period). PunchPay is **not** an escrow service, construction certification, or guaranteed payment mechanism.

## Architecture & Key Features

- **Role-Based Authentication & Demo Accounts (`/login`)**: Server-backed HMAC-SHA256 HTTP-only cookie sessions (`sessions` table) with scrypt password hashing and clearly labeled Demo Homeowner (`homeowner@punchpay.demo`) and Demo Contractor (`contractor@punchpay.demo`) accounts.
- **Homeowner Command Center (`/dashboard`)**: Live KPI calculations (Total Repair Value, Authorized, Captured, Voided, Awaiting Review), status filters, search, pending decision alerts, and real-time financial event timeline.
- **4-Step Project Wizard (`/projects/new`)**: Create multi-task projects, define prices in integer minor units, refine acceptance criteria with the real **AI Scope Assistant**, or launch the **1-Click Guided Demo** (`$30 Painting` + `$20 Tile Repair`).
- **Project Dossier & Guided Progress Tracker (`/projects/[id]`)**: Interactive repair task cards, draft term editing prior to PayPal order creation, 6-step milestone tracker, and verified settlement closing frame.
- **PayPal Payment Control Center (`/payments`)**: Official PayPal JS SDK authorization buttons (`intent=authorize`), lifecycle timelines, PayPal Order/Authorization/Capture IDs, and GET-based status reconciliation (`/api/tasks/[id]/reconcile`).
- **Contractor Workspace (`/contractor`)**: Filtered task queues, drag-and-drop photo uploader with live XHR progress bar, Sharp magic-byte validation & EXIF stripping, private photo storage, a 4-image `800×600` Demo Photo Kit (`public/demo-kit/`), completion notes, and AI inspection trigger.
- **AI Evidence Inspection & Settlement Decisions (`/tasks/[id]`, `/reviews`)**: Interactive before/after comparison (**Side by side** with persistent click-to-drop **Pin Annotations**, **Wipe Slider**, **Onion-Skin Overlay**, and **2× Zoom**), 9-part Zod-validated multimodal AI report (supports Google Gemini or Anthropic Claude), and homeowner confirmation modals for Accept/Capture, Reject/Void, Request Corrections, and Request More Evidence.
- **PayPal Fault-Injection & Idempotency Lab (`/playground`)**: Explicitly separated offline simulator with live PayPal v2 JSON Wire Trace demonstrating split settlement, dropped HTTP responses (`RECONCILIATION_REQUIRED` → GET reconcile), double-click idempotency, and rogue payee merchant guards.
- **Settlement Ledger (`/ledger`)**: Filterable transaction table, Transaction Detail Drawer with PayPal references & event history, and CSV export (`/api/ledger?format=csv`).
- **PayPal Webhook Verification (`/api/webhooks/paypal`)**: Server-side verification via `/v1/notifications/verify-webhook-signature` and idempotent event deduplication (`paypal_event_id`).

## Documentation

- [Architecture Overview](docs/ARCHITECTURE.md)
- [Setup & Migration Guide](docs/SETUP.md)
- [API Reference](docs/API.md)
- [3-Minute Demo Script](DEMO-SCRIPT.md)
- [License (MIT)](LICENSE)

## Local Setup

```bash
npm install
cp .env.example .env.local
```

PunchPay persists projects, tasks, sessions, private photos, and settlement history out of the box via Node 22 built-in SQLite (`.data/punchpay.db`). To use Supabase PostgreSQL + Storage instead, apply `supabase/migrations/20261111000000_punchpay_v2.sql` and set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

To enable live PayPal Sandbox transactions and live AI inspections, add your credentials in `.env.local`:
- `PAYPAL_CLIENT_ID`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID` (and optional `PAYPAL_WEBHOOK_ID`)
- `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`

Run locally:
```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run dev
```

## Verification Status

| Feature / Check | Implemented | Tested | Result | Evidence |
| --- | --- | --- | --- | --- |
| TypeScript & Production Build | Yes | Yes | Passing | `npm run typecheck`, `npm run build` |
| State Machine, PayPal Client & SQLite Integration | Yes | Yes | 10/10 Passing (mocked PayPal HTTP) | `npm test` (`tests/*.test.ts`) |
| Full Interactive Browser Workflow (Desktop + Mobile) | Yes | Yes | 2/2 Passing (0 console/404 errors) | `npm run test:e2e`, `docs/screenshots/` |
| Live PayPal Sandbox Orders / Capture / Void | Yes | Pending Credentials | Blocked on external sandbox credentials | Requires `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID` |
| Live AI Multimodal Inspection & Scope Assistant | Yes | Pending Credentials | Blocked on external AI API key | Requires `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` |
| Supabase Postgres + Storage Driver | Yes | Pending Credentials | Built; local SQLite active by default | `supabase/migrations/20261111000000_punchpay_v2.sql` |
