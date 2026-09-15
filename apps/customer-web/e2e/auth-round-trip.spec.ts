import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

/** §3.3's own Done-when, driven in a real browser end to end: the
 * landing page states what Print Automated does with both §12.1 CTAs,
 * an unauthenticated /dashboard request redirects, and a full
 * register -> dashboard -> logout -> redirected -> log back in ->
 * dashboard round trip works against the real backend (real Postgres,
 * real argon2id/JWT issuance) with real httpOnly cookies set by this
 * app's own route handlers -- not anything mocked. */
test.describe("Customer web auth round trip (3.3)", () => {
  test("register, reach the dashboard, log out, get redirected, log back in", async ({ page }) => {
    const email = `pw-${randomUUID()}@print-automated.dev`;
    const password = "password123";

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Print Automated" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start Printing" })).toBeVisible();
    await expect(page.getByRole("link", { name: "For Print Shops" })).toBeVisible();

    // An unauthenticated /dashboard request redirects (3.3's Done-when).
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/signup");
    await page.getByLabel("Name").fill("Playwright Test User");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    // Registering established a real session (httpOnly cookies set by
    // /api/auth/register) -- the dashboard is now reachable.
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login/);

    // The session is really gone, not just the current page's memory of it.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);

    // Logging back in with the same, now-registered credentials
    // completes the round trip.
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("a wrong password is rejected with a visible error, not a silent failure", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(`nobody-${randomUUID()}@print-automated.dev`);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
