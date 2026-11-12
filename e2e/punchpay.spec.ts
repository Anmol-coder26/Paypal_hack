import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import sharp from "sharp";

const SCREENSHOT_DIR = path.resolve(__dirname, "../docs/screenshots");

// Valid 64x64 solid-color PNG for arbitrary upload guided-fallback E2E check
let ARBITRARY_PNG: Buffer = Buffer.alloc(0);

test.beforeAll(async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  ARBITRARY_PNG = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 72, g: 130, b: 196 },
    },
  })
    .png()
    .toBuffer();
});

test("full PunchPay interactive demo workflow across simulation settlement, prepared demo & guided inspections, persistence, reset, and responsive layouts", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      consoleErrors.push(`HTTP ${res.status()} ${res.url()}`);
    }
  });

  // 1. Landing Page + Accessibility Check
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Pay for the work that's done/i })
  ).toBeVisible();
  const landingAxe = await new AxeBuilder({ page }).analyze();
  expect(
    landingAxe.violations.filter((v) => v.impact === "critical" || v.impact === "serious")
  ).toEqual([]);
  if (testInfo.project.name === "desktop") {
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "01-landing-desktop.png"),
      fullPage: true,
    });
  }

  // Zero horizontal overflow
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(overflow).toBe(false);

  // 2. Sign in as Demo Homeowner -> verify Demo environment badge
  await page.goto("/login");
  await page.getByRole("button", { name: /Demo Homeowner/i }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText(/Demo environment · Payments simulated/i).first()).toBeVisible();

  // 3. Create custom multi-step project + test Edit Project persistence
  await page.goto("/projects/new");
  await page.getByPlaceholder(/Oak Street Closeout Repairs/i).fill("Maple Ave Verification");
  await page.getByPlaceholder(/Austin, TX/i).fill("Austin, TX · Unit 2A");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByPlaceholder(/Living room wall painting/i).fill("Drywall Patch");
  await page.getByPlaceholder(/Describe the repair clearly/i).fill("Patch drywall hole");
  await page.getByPlaceholder(/Coverage looks uniform/i).fill("Surface flush\nPaint uniform");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Create Project & Open Dossier/i }).click();

  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  const customProjectUrl = page.url();
  await expect(page.getByRole("heading", { name: "Maple Ave Verification" })).toBeVisible();

  // Edit project location -> verify saved after reload
  await page.getByRole("button", { name: /Edit Project/i }).click();
  const locInput = page.locator("form input").nth(1);
  await locInput.fill("Austin, TX · Unit 2B");
  await page.getByRole("button", { name: /Save Project/i }).click();
  await page.reload();
  await expect(page.getByText("Austin, TX · Unit 2B")).toBeVisible();
  await expect(page.getByText("Drywall Patch")).toBeVisible();

  // 4. Launch 1-Click Guided Demo (Kitchen Renovation Closeout · $30 Painting + $20 Tile Repair)
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /Continue Guided Demo/i }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  const demoProjectUrl = page.url();
  await expect(page.getByText("Kitchen Renovation Closeout").first()).toBeVisible();
  await expect(page.getByText("$50.00").first()).toBeVisible();

  // 4b. Authorize both simulated holds via realistic confirmation modal (DEMO-ORD- -> DEMO-AUTH-)
  await page.getByRole("button", { name: /Authorize \$30\.00/i }).click();
  await expect(page.getByText(/What authorization means:/i)).toBeVisible();
  await page.getByRole("button", { name: /Create \$30\.00 Demo Order/i }).click();
  await expect(page.getByText(/DEMO-ORD-/i).first()).toBeVisible();
  await page.getByRole("button", { name: /Confirm Buyer Approval \(\$30\.00 Hold\)/i }).click();
  await expect(page.getByText(/DEMO-AUTH-/i).first()).toBeVisible();

  await page.getByRole("button", { name: /Authorize \$20\.00/i }).click();
  await page.getByRole("button", { name: /Create \$20\.00 Demo Order/i }).click();
  await page.getByRole("button", { name: /Confirm Buyer Approval \(\$20\.00 Hold\)/i }).click();
  await expect(page.getByText(/Payments Authorized/i)).toBeVisible();

  // Verify Homeowner navigating directly to /contractor redirects cleanly back to /dashboard
  await page.goto("/contractor");
  await page.waitForURL("**/dashboard");

  // 5. Switch to Demo Contractor -> upload sample photos on Painting & Tile + arbitrary PNG on custom task
  await page.goto("/login");
  await page.getByRole("button", { name: /Demo Contractor/i }).click();
  await page.waitForURL("**/contractor");
  await expect(page.getByRole("heading", { name: "Contractor Workspace" })).toBeVisible();

  // Upload Before + After for Painting
  await page.getByRole("button", { name: /Painting.*Kitchen Renovation Closeout/i }).first().click();
  await page.getByRole("button", { name: "Load Sample Before" }).click();
  await expect(page.getByText(/BEFORE photo uploaded/i)).toBeVisible();
  await page.getByRole("button", { name: "Load Sample After" }).click();
  await expect(page.getByText(/AFTER photo uploaded/i)).toBeVisible();

  // Drop Pin #1 on Before & Pin #2 on After
  await page.getByRole("button", { name: /Drop Pin/i }).click();
  const beforeImg = page.getByAltText("Before Repair photograph");
  await beforeImg.scrollIntoViewIfNeeded();
  await beforeImg.click({ position: { x: 80, y: 60 } });
  await page.getByPlaceholder(/Open grout gap/i).fill("Original wall scuff documented");
  await page.getByRole("button", { name: /Save Pin Annotation/i }).click();
  await expect(page.getByText("Original wall scuff documented")).toBeVisible();

  await page.getByRole("button", { name: /Drop Pin/i }).click();
  const afterImg = page.getByAltText("After Repair photograph");
  await afterImg.scrollIntoViewIfNeeded();
  await afterImg.click({ position: { x: 100, y: 80 } });
  await page.getByPlaceholder(/Open grout gap/i).fill("Uniform repaint verified");
  await page.getByRole("button", { name: /Save Pin Annotation/i }).click();
  await expect(page.getByText("Uniform repaint verified")).toBeVisible();
  await expect(page.getByTitle(/#2 /i)).toBeVisible();

  // Upload Before + After for Tile Repair as well
  await page.getByRole("button", { name: /Tile Repair.*Kitchen Renovation Closeout/i }).first().click();
  await page.getByRole("button", { name: "Load Sample Before" }).click();
  await expect(page.getByText(/BEFORE photo uploaded/i)).toBeVisible();
  await page.getByRole("button", { name: "Load Sample After" }).click();
  await expect(page.getByText(/AFTER photo uploaded/i)).toBeVisible();

  // Upload arbitrary non-sample PNGs on Maple Ave "Drywall Patch" to test Guided Checklist fallback
  await page.getByRole("button", { name: /Drywall Patch.*Maple Ave Verification/i }).first().click();
  const fileInputs = page.locator('input[type="file"]');
  await fileInputs.nth(0).setInputFiles({
    name: "custom-before.png",
    mimeType: "image/png",
    buffer: ARBITRARY_PNG,
  });
  await expect(page.getByText(/BEFORE photo uploaded/i)).toBeVisible();
  await fileInputs.nth(1).setInputFiles({
    name: "custom-after.png",
    mimeType: "image/png",
    buffer: ARBITRARY_PNG,
  });
  await expect(page.getByText(/AFTER photo uploaded/i)).toBeVisible();

  // Test Wipe, Overlay and 2x Zoom comparison toggles + screenshot
  await page.reload();
  await page.getByRole("button", { name: /Painting.*Kitchen Renovation Closeout/i }).first().click();
  await expect(page.getByAltText("Before Repair photograph")).toBeVisible();
  await expect(page.getByText("Uniform repaint verified")).toBeVisible();

  if (testInfo.project.name === "desktop") {
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "04-contractor-evidence-desktop.png"),
      fullPage: true,
    });
  }

  await page.getByRole("button", { name: "2×" }).click();
  await expect(page.getByRole("button", { name: "1×" })).toBeVisible();
  await page.getByRole("button", { name: "Wipe" }).click();
  await expect(page.getByLabel(/Before and after comparison position/i)).toBeVisible();
  await page.getByRole("button", { name: "Overlay" }).click();
  await expect(page.getByLabel(/Onion-skin opacity/i)).toBeVisible();

  // 6. Switch back to Demo Homeowner -> test Guided Review on arbitrary custom task + Prepared Demo on Painting/Tile
  await page.goto("/login");
  await page.getByRole("button", { name: /Demo Homeowner/i }).click();
  await page.waitForURL("**/dashboard");

  // Arbitrary photos must NOT receive prepared demo report -> open Guided Review checklist & save
  await page.goto(customProjectUrl);
  await page.locator("a", { hasText: /Inspect & Decide/i }).first().click();
  await page.waitForURL(/\/tasks\//);
  await page.getByRole("button", { name: /Run Inspection/i }).click();
  await expect(page.getByText(/Guided Review — Visual assessment by homeowner/i)).toBeVisible();
  await page.getByRole("button", { name: /Save Guided Review/i }).click();
  await expect(page.getByText(/Guided Review · Visual assessment by homeowner/i).first()).toBeVisible();

  // Settle Guided Demo Painting ($30 -> Prepared Demo Satisfactory -> Reload -> Q&A -> Accept & Capture DEMO-CAP-)
  await page.goto(demoProjectUrl);
  await page.locator("a", { hasText: /Inspect & Decide/i }).first().click();
  await page.waitForURL(/\/tasks\//);
  await page.getByRole("button", { name: /Run Inspection/i }).click();
  await expect(page.getByText(/Sample inspection · Prepared findings/i).first()).toBeVisible();
  await expect(page.getByText(/Appears satisfactory from visible evidence/i)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Sample inspection · Prepared findings/i).first()).toBeVisible();

  await page.getByRole("button", { name: "What happens if I reject this repair?" }).click();
  await expect(page.getByText(/Simulation mode/i).first()).toBeVisible();

  await page.getByRole("button", { name: /Accept & Capture \$30\.00/i }).click();
  await page.getByRole("button", { name: "Capture $30.00", exact: true }).click();
  await expect(page.getByText(/Accepted · \$30\.00 Captured/i)).toBeVisible();
  await expect(page.getByText(/DEMO-CAP-/i).first()).toBeVisible();

  // Settle Guided Demo Tile Repair ($20 -> Prepared Demo Concerns -> Reject & Void DEMO-VOID-)
  await page.goto(demoProjectUrl);
  await page.locator("a", { hasText: /Inspect & Decide/i }).first().click();
  await page.waitForURL(/\/tasks\//);
  await page.getByRole("button", { name: /Run Inspection/i }).click();
  await expect(page.getByText(/Sample inspection · Prepared findings/i).first()).toBeVisible();
  await expect(page.getByText(/Visible concerns identified/i)).toBeVisible();

  await page.getByRole("button", { name: /Reject & Void Hold/i }).click();
  await page.getByRole("button", { name: "Void Authorization", exact: true }).click();
  await expect(page.getByText(/Rejected · \$20\.00 Authorization Voided/i)).toBeVisible();
  await expect(page.getByText(/DEMO-VOID-/i).first()).toBeVisible();

  // Verify Project Final Settlement Statement ($50 Agreed / $30 Captured / $20 Voided / $0 Outstanding)
  await page.goto(demoProjectUrl);
  await expect(page.getByText(/Final Settlement Statement/i)).toBeVisible();
  if (testInfo.project.name === "desktop") {
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "02-project-detail-desktop.png"),
      fullPage: true,
    });
  } else {
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "05-project-detail-mobile.png"),
      fullPage: true,
    });
  }

  // 7. Verify remaining destinations + reload persistence on Settlement Ledger + Reset Demo
  await page.goto("/payments");
  await expect(page.getByRole("heading", { name: "Payment Control" })).toBeVisible();
  await page.goto("/reviews");
  await expect(page.getByRole("heading", { name: "AI Evidence Reviews" })).toBeVisible();
  await page.goto("/ledger");
  await expect(page.getByRole("heading", { name: "Settlement Ledger" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Kitchen Renovation Closeout").first()).toBeVisible();
  await expect(page.getByText(/DEMO-CAP-/i).first()).toBeVisible();
  await expect(page.getByText(/DEMO-VOID-/i).first()).toBeVisible();
  if (testInfo.project.name === "desktop") {
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "03-settlement-ledger-desktop.png"),
      fullPage: true,
    });
  }

  // Verify Reset Demo resets only guided demo while preserving Maple Ave Verification
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Reset Demo" }).click();
  await page.getByRole("button", { name: /Confirm Reset Demo/i }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("button", { name: /Authorize \$30\.00/i })).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByText("Maple Ave Verification").first()).toBeVisible();

  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: /Settings & Environment Diagnostics/i })
  ).toBeVisible();
  await expect(page.getByText(/Demo Mode Active \(AI_PROVIDER=demo\)/i)).toBeVisible();
  await expect(
    page.getByText(/Administrator access required to manage AI credentials/i)
  ).toBeVisible();
  await expect(page.locator("#gemini-api-key")).toHaveCount(0);

  // 8. Interactive PayPal Fault-Injection Lab (/playground)
  await page.goto("/playground");
  await expect(
    page.getByRole("heading", { name: /PayPal Settlement & Fault-Recovery Lab/i })
  ).toBeVisible();

  await page.getByLabel(/Drop HTTP response after next Capture/i).check();
  await page.getByRole("button", { name: /1\. Authorize Hold/i }).first().click();
  await page.getByRole("button", { name: /2\. Submit Photos \+ AI/i }).first().click();
  await page.getByRole("button", { name: /3a\. Capture/i }).first().click();
  await expect(page.getByText(/RECONCILIATION_REQUIRED/i).first()).toBeVisible();
  await page.getByRole("button", { name: /GET Reconcile Status/i }).click();
  await expect(page.getByText(/1 capture\(s\)/i)).toBeVisible();

  if (testInfo.project.name === "desktop") {
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "06-paypal-fault-lab-desktop.png"),
      fullPage: true,
    });
  }

  expect(consoleErrors).toEqual([]);
});

test("Admin AI configuration UI encrypts, isolates, tests, replaces, and removes Gemini API key", async ({
  page,
}, testInfo) => {
  // 1. Verify homeowner cannot call admin AI credential APIs (403)
  await page.goto("/login");
  await page.getByRole("button", { name: /Demo Homeowner/i }).click();
  await page.waitForURL("**/dashboard");

  const putForbidden = await page.evaluate(async () => {
    const res = await fetch("/api/settings/ai", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "AIzaHomeownerBlockedKey123", model: "gemini-3.5-flash" }),
    });
    return res.status;
  });
  expect(putForbidden).toBe(403);

  // 2. Sign in as Demo Administrator -> /settings
  await page.goto("/login");
  await page.getByRole("button", { name: /System Administrator/i }).click();
  await page.waitForURL("**/settings");

  const keyInput = page.getByLabel("Gemini API Key");
  await expect(keyInput).toHaveAttribute("type", "password");
  const testSecret = "AIzaSyBrowserE2ETestKey987654";
  await keyInput.fill(testSecret);

  await page.getByRole("button", { name: /Show API key/i }).click();
  await expect(keyInput).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: /Hide API key/i }).click();
  await expect(keyInput).toHaveAttribute("type", "password");

  await page.getByRole("button", { name: "Save API Key" }).click();
  await expect(page.getByText(/Gemini Configured \(Encrypted Vault\)/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace Key" })).toBeVisible();

  const healthText = await page.evaluate(async () => {
    const r = await fetch("/api/health");
    return r.text();
  });
  expect(healthText).not.toContain(testSecret);
  expect(JSON.parse(healthText).config.ai.gemini.configured).toBe(true);

  if (testInfo.project.name === "desktop") {
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "07-settings-ai-config-desktop.png"),
      fullPage: true,
    });
  }

  await page.getByRole("button", { name: "Replace Key" }).click();
  const replacementSecret = "AIzaSyReplacementMockKey00001";
  await page.getByLabel("Gemini API Key").fill(replacementSecret);
  await page.getByRole("button", { name: "Save API Key" }).click();
  await expect(page.getByText(/Gemini API key encrypted and saved/i)).toBeVisible();

  await page.getByRole("button", { name: "Remove Key" }).click();
  await expect(page.getByLabel("Gemini API Key")).toBeVisible();
});
