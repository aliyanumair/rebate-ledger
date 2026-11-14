import { expect, test } from "@playwright/test";
import path from "node:path";

test("live demo upload extracts contract rules and reconciles the synthetic benchmark", async ({ page }) => {
  const liveUrl = process.env.LIVE_URL?.trim();
  const email = process.env.DEMO_EMAIL?.trim();
  const password = process.env.DEMO_PASSWORD;
  expect(liveUrl, "LIVE_URL repository secret is required").toBeTruthy();
  expect(email, "DEMO_EMAIL repository secret is required").toBeTruthy();
  expect(password, "DEMO_PASSWORD repository secret is required").toBeTruthy();

  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(new URL("/login", liveUrl).toString());
  await page.getByLabel("Email address").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const uploadUrl = new URL("/dashboard/upload", liveUrl).toString();
  await expect.poll(async () => {
    await page.goto(uploadUrl);
    return page.locator('[data-extraction-runtime="pdf2json-node-text-v1"]').count();
  }, { message: "wait for the current push to finish deploying to the live site", timeout: 10 * 60_000, intervals: [5_000, 10_000, 15_000] }).toBe(1);
  await expect(page.getByRole("heading", { name: "Upload supplier files" })).toBeVisible();

  const contractPath = path.join(process.cwd(), "data/benchmark/launch_sprint/01_supplier_agreement_demo.pdf");
  const purchasePath = path.join(process.cwd(), "data/benchmark/launch_sprint/02_erp_purchase_export_demo.csv");
  await page.getByLabel("Upload supplier audit files").setInputFiles([contractPath, purchasePath]);
  await expect(page.getByLabel("Tier 2 rebate rate")).toHaveValue("3");
  await expect(page.getByLabel("Tier 1 rebate rate")).toHaveValue("2");
  await expect(page.locator("textarea")).toHaveCount(0);

  await page.getByLabel("Supplier name").fill("RebateLedger Live Bot Synthetic Supplier");
  await page.getByLabel("Verified by").fill("Automated live-site health bot");
  await page.getByLabel("Supplier credits received").fill("7246.00");
  await page.getByRole("button", { name: "Lock verified rules" }).click();
  await expect(page.getByText("Rules verified", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run verified reconciliation" }).click();
  await expect(page.getByRole("heading", { name: "Reconciliation ready" })).toBeVisible({ timeout: 45_000 });

  const results = page.locator(".result-ready");
  await expect(results).toContainText("$399,800.00");
  await expect(results).toContainText("$7,996.00");
  await expect(results).toContainText("$7,246.00");
  await expect(results).toContainText("$750.00");
  await expect(results).toContainText("$4,004.00");
  await expect(page.getByRole("alert").filter({ hasText: /DOMMatrix|\bError\b|\b500\b/i })).toHaveCount(0);
  expect(pageErrors, "browser runtime errors").toEqual([]);
  expect(serverErrors, "HTTP 500 responses").toEqual([]);

  const visibleText = await page.locator("body").innerText();
  expect(visibleText).not.toMatch(/DOMMatrix/i);
});
