import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { expect, test } from "@playwright/test";

const SCREENSHOT_DIR = path.resolve(__dirname, "../docs/screenshots");

test.beforeAll(() => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

test("full PunchPay 2.0 interactive workflow across homeowner, contractor, persistence, and responsive layouts", async ({
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

  // 1. Landing Page
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Pay for the work that's done/i })
  ).toBeVisible();
  if (testInfo.project.name === "desktop") {
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "01-landing-desktop.png"),
      fullPage: true,
    });
  }

  // Check zero horizontal overflow
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  );
  expect(overflow).toBe(false);

  // 2. Sign in as Demo Homeowner
  await page.goto("/login");
  await page.getByRole("button", { name: /Demo Homeowner/i }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: "Homeowner Command Center" })).toBeVisible();

  // 3. Create custom multi-step project via Wizard
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
  await expect(page.getByRole("heading", { name: "Maple Ave Verification" })).toBeVisible();

  // Verify persistence after refresh
  await page.reload();
  await expect(page.getByRole("heading", { name: "Maple Ave Verification" })).toBeVisible();
  await expect(page.getByText("Drywall Patch")).toBeVisible();

  // 4. Launch 1-Click Guided Demo ($30 Painting + $20 Tile Repair)
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /Guided Demo/i }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Oak Street Living & Kitchen Closeout")).toBeVisible();
  await expect(page.getByText("$50.00")).toBeVisible();

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

  // 5. Inspect all homeowner screens
  await page.goto("/payments");
  await expect(
    page.getByRole("heading", { name: "PayPal Payment Control Center" })
  ).toBeVisible();
  await page.goto("/reviews");
  await expect(page.getByRole("heading", { name: "AI Evidence Reviews" })).toBeVisible();
  await page.goto("/ledger");
  await expect(page.getByRole("heading", { name: "Settlement Ledger" })).toBeVisible();
  if (testInfo.project.name === "desktop") {
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "03-settlement-ledger-desktop.png"),
      fullPage: true,
    });
  }
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: /Settings & Sandbox Diagnostics/i })
  ).toBeVisible();

  // 6. Switch to Demo Contractor and upload real before/after PNGs
  await page.goto("/login");
  await page.getByRole("button", { name: /Demo Contractor/i }).click();
  await page.waitForURL("**/contractor");
  await expect(page.getByRole("heading", { name: "Contractor Workspace" })).toBeVisible();

  const beforePng = await sharp({
    create: { width: 120, height: 90, channels: 3, background: { r: 190, g: 185, b: 175 } },
  })
    .png()
    .toBuffer();
  const afterPng = await sharp({
    create: { width: 120, height: 90, channels: 3, background: { r: 235, g: 235, b: 230 } },
  })
    .png()
    .toBuffer();

  const inputs = page.locator('input[type="file"]');
  await inputs.nth(0).setInputFiles({
    name: "before.png",
    mimeType: "image/png",
    buffer: beforePng,
  });
  await expect(page.getByText(/BEFORE photo uploaded/i)).toBeVisible();

  await inputs.nth(1).setInputFiles({
    name: "after.png",
    mimeType: "image/png",
    buffer: afterPng,
  });
  await expect(page.getByText(/AFTER photo uploaded/i)).toBeVisible();

  // Reload and confirm evidence persists
  await page.reload();
  await expect(page.getByAltText("Before Repair photograph")).toBeVisible();
  await expect(page.getByAltText("After Repair photograph")).toBeVisible();

  if (testInfo.project.name === "desktop") {
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "04-contractor-evidence-desktop.png"),
      fullPage: true,
    });
  }

  expect(consoleErrors).toEqual([]);
});
