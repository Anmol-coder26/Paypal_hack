# PunchPay 2.0 — 3-Minute Hackathon Demo Script

**Core story:** A homeowner hires a contractor for **$50** across two independent repairs (**Painting — $30** and **Tile Repair — $20**). Instead of bundling everything into one payment, PunchPay authorizes each task separately via PayPal, inspects photo evidence with multimodal AI, captures **$30** for completed painting, and voids the **$20** hold for defective tile work.

## Shot-by-Shot Storyboard (2:45)

1. **0:00 – 0:25 · Landing & Problem**
   - Open `/` (`Pay for the work that's done. Not the work that isn't.`).
   - Briefly explain why bundled renovation invoices fail when one fix is done and another isn't.
   - Click **Start a Project** -> sign in via **Demo Homeowner**.

2. **0:25 – 0:55 · Create Guided Project & Authorize Two PayPal Holds**
   - Click **Guided Demo ($50 · 2 Tasks)** from the Homeowner Command Center (creates *Oak Street Living & Kitchen Closeout* with Painting `$30.00` and Tile Repair `$20.00`).
   - Note the 6-step Progress Tracker starts at Step 1 (*Project Created*).
   - Open **Authorize $30.00** -> approve in PayPal Sandbox Personal popup -> server authorizes and saves PayPal Authorization ID.
   - Open **Authorize $20.00** -> approve in PayPal Sandbox Personal popup -> Progress Tracker advances to Step 2 (*Payments Authorized*).

3. **0:55 – 1:35 · Contractor Uploads Evidence & Runs AI Inspection**
   - Click **Switch to Demo Contractor** in the sidebar.
   - In **Contractor Desk**, select **Painting**, click **Load Sample Before** and **Load Sample After** (or upload your own photos through the Sharp sanitization pipeline), then click **Run AI Inspection**.
   - Switch to **Tile Repair**, click **Load Sample Before** (cracked tile) and **Load Sample After** (misaligned tile with open grout gap), optionally drop a Before/After inspection pin, and click **Run AI Inspection**.
   - Show the **End-to-End Settlement Pipeline** advances cleanly to Step 4 (*AI Reviews Complete*).

4. **1:35 – 2:20 · Homeowner Reviews Findings & Settles Independently**
   - Click **Switch to Demo Homeowner** in the sidebar and open **Oak Street Living & Kitchen Closeout**.
   - Open **Painting** (`/tasks/[id]`): drag the **Before ⟷ After** wipe slider (`2×` zoom & synchronized pins `#1`/`#2`), read AI's *Appears Satisfied* checklist, click **Accept & Capture $30.00** -> confirm dialog -> verify PayPal Capture (`COMPLETED`).
   - Open **Tile Repair** (`/tasks/[id]`): inspect AI's *Concerns Identified* + uncertainty notes, click **Reject & Void Hold** -> confirm dialog -> verify PayPal Authorization Void (`VOIDED`).

5. **2:20 – 2:45 · Closing Summary & Settlement Ledger**
   - Return to `/projects/[id]` to show the compact 4-stage PayPal lifecycle inside each task card and the **PayPal Settlement Verified** closing banner (`$50.00` total · `$30.00 Captured` · `$20.00 Voided` with persisted PayPal Order, Authorization, and Capture IDs).
   - Open `/ledger`, press **Reload (`F5`)** to prove database persistence, click a row to inspect full PayPal timestamps & **Reconcile Status from PayPal** in the Transaction Record Drawer, and click **Export CSV**.
