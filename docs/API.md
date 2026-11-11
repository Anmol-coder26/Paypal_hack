# PunchPay 2.0 API Reference

All API routes run server-side and authenticate callers via the HTTP-only `punchpay_session` cookie (except `/api/health`, `/api/auth/login`, `/api/auth/register`, and `/api/webhooks/paypal`).

| Method & Route | Auth / Role | Purpose |
| --- | --- | --- |
| `POST /api/auth/login` | Public | Password login (`mode: "password"`) or sandbox demo session (`mode: "demo"`) |
| `POST /api/auth/register` | Public | Create homeowner or contractor profile with salted `scrypt` password |
| `POST /api/auth/logout` | Any | Delete session record and clear cookie |
| `GET /api/auth/me` | Optional | Current user profile, contractors list, and integration config status |
| `GET /api/health` | Public | Database driver (`sqlite` / `supabase`) and integration status |
| `GET /api/projects` | Homeowner or Contractor | List user's projects, tasks, and payment events |
| `POST /api/projects` | Homeowner only | Create custom multi-task project or 1-click Guided Demo (`guided_demo: true`) |
| `GET /api/projects/[id]` | Member | Full project bundle with hydrated tasks, evidence, reviews, and events |
| `POST /api/projects/[id]` | Homeowner only | Add a new draft repair task to an existing project |
| `GET /api/tasks/[id]` | Member | Task bundle + parent project |
| `PATCH /api/tasks/[id]` | Homeowner (`DRAFT` terms) / Contractor (`contractor_notes`) | Edit task terms prior to PayPal order creation, or update contractor notes |
| `DELETE /api/tasks/[id]` | Homeowner only (`DRAFT` only) | Delete an unfunded draft repair task |
| `POST /api/ai/scope-assistant` | Homeowner only | Call configured AI provider (Gemini/Claude) to suggest visual acceptance criteria |
| `POST /api/tasks/[id]/create-order` | Homeowner only | Create PayPal Orders v2 `AUTHORIZE` order pinned to `PAYPAL_MERCHANT_ID` |
| `POST /api/tasks/[id]/authorize` | Homeowner only | Verify buyer `APPROVED` status and authorize PayPal hold |
| `POST /api/tasks/[id]/upload` | Contractor only | Validate magic bytes, strip EXIF via Sharp, save private evidence image |
| `GET /api/evidence/[id]` | Project Member | Stream private evidence bytes with `Cache-Control: private, no-store` |
| `DELETE /api/evidence/[id]` | Contractor only | Remove un-settled evidence image |
| `POST /api/tasks/[id]/review` | Member | Run live multimodal AI vision inspection across before/after photos |
| `POST /api/tasks/[id]/decision` | Homeowner only | Execute `accept` (PayPal Capture), `reject` (PayPal Void), `request_corrections`, or `request_evidence` |
| `POST /api/tasks/[id]/reconcile` | Member | GET-only PayPal status reconciliation (orders, authorizations, captures) |
| `GET /api/ledger` | Member | JSON settlement ledger (`?format=csv` downloads CSV export) |
| `POST /api/webhooks/paypal` | PayPal Signature | Verify webhook signature via `/v1/notifications/verify-webhook-signature` and process idempotently |
