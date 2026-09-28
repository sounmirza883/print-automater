import { randomUUID } from "node:crypto";
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext } from "@playwright/test";

const API_BASE = "http://localhost:3000/v1";
const SHOP_NAME = "Downtown Print & Copy (full-service)";
const COUNTER_EMAIL = "counter-a@print-automated.dev";
// §1.3's own fixed dev-only seed password -- never a real credential,
// the same value every other seeded-account reference in this repo
// already documents.
const COUNTER_PASSWORD = "DevPassword123!";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = path.join(__dirname, "../../../services/worker/test/fixtures/valid.pdf");

function generateAgentKeypair(): { publicKeyBase64Url: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return { publicKeyBase64Url: jwk.x, privateKey };
}

function signNonce(privateKey: KeyObject, nonce: string): string {
  return cryptoSign(null, Buffer.from(nonce, "utf8"), privateKey).toString("base64url");
}

async function counterAccessToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API_BASE}/auth/login`, {
    data: { email: COUNTER_EMAIL, password: COUNTER_PASSWORD },
  });
  expect(res.ok()).toBe(true);
  const { accessToken } = (await res.json()) as { accessToken: string };
  return accessToken;
}

/** Everything the real printer-agent process (apps/printer-agent-cpp) would
 * do against the real backend HTTP surface -- claim the queued job,
 * download the decrypted document, report success -- except actually
 * driving a printer, which 13.1's own Build line names as the one step
 * "performed manually against the real printer." This is the same
 * FakePrinterDriver substitution 9.9/13.2 already established for CI:
 * the backend-facing contract is exercised for real, only the physical
 * print command itself is the acknowledged, unautomatable gap. */
async function actAsAgentAndPrint(
  apiRequest: APIRequestContext,
  counterToken: string,
  orderId: string,
  shopId: string,
): Promise<void> {
  const pairing = await apiRequest.post(`${API_BASE}/shop/agents/pairing-code`, {
    headers: { Authorization: `Bearer ${counterToken}` },
    data: { shopId },
  });
  expect(pairing.ok()).toBe(true);
  const { code } = (await pairing.json()) as { code: string };

  const { publicKeyBase64Url, privateKey } = generateAgentKeypair();
  const deviceId = randomUUID();
  const register = await apiRequest.post(`${API_BASE}/agents/register`, {
    data: { pairingCode: code, deviceId, publicKey: publicKeyBase64Url },
  });
  expect(register.ok()).toBe(true);

  const challengeRes = await apiRequest.post(`${API_BASE}/agents/authenticate/challenge`, {
    data: { deviceId },
  });
  const { nonce } = (await challengeRes.json()) as { nonce: string };
  const signature = signNonce(privateKey, nonce);
  const authRes = await apiRequest.post(`${API_BASE}/agents/authenticate`, {
    data: { deviceId, signature },
  });
  expect(authRes.ok()).toBe(true);
  const { accessToken: agentToken } = (await authRes.json()) as { accessToken: string };

  // §36/8.3: accept only dispatches to a printer that's already
  // eligible -- this agent must announce its printer before accept
  // runs, matching real agent behavior (an agent is online before any
  // job can reach it).
  const printerName = `Golden Path Printer ${randomUUID()}`;
  const heartbeat = await apiRequest.post(`${API_BASE}/agents/heartbeat`, {
    headers: { Authorization: `Bearer ${agentToken}` },
    data: {
      printers: [
        {
          name: printerName,
          status: "ONLINE",
          capabilities: { color: false, duplex: false, a4: true, a3: false },
        },
      ],
    },
  });
  expect(heartbeat.ok()).toBe(true);

  // This suite runs no cleanup between runs, so this shop has
  // accumulated other ONLINE printers from earlier runs whose own
  // agent sessions are long gone -- acceptOrder()'s own "any eligible
  // printer" dispatch could pick one of those instead of the one just
  // registered above, and this run's own long-poll would then wait
  // forever for a job that went to a dead agent. Same fix
  // duplicate-print-campaign.e2e-spec.ts already established for the
  // identical reason: disable every other printer first so dispatch is
  // deterministic.
  const printersRes = await apiRequest.get(`${API_BASE}/shop/printers?shopId=${shopId}`, {
    headers: { Authorization: `Bearer ${counterToken}` },
  });
  expect(printersRes.ok()).toBe(true);
  const printers = (await printersRes.json()) as Array<{
    id: string;
    name: string;
    status: string;
  }>;
  await Promise.all(
    printers
      .filter((printer) => printer.name !== printerName && printer.status !== "DISABLED")
      .map((printer) =>
        apiRequest.patch(`${API_BASE}/shop/printers/${printer.id}`, {
          headers: { Authorization: `Bearer ${counterToken}` },
          data: { enabled: false },
        }),
      ),
  );

  // 17. Employee selects ACCEPT & PRINT. 18. Backend authorizes print job.
  const accept = await apiRequest.post(`${API_BASE}/shop/orders/${orderId}/accept`, {
    headers: { Authorization: `Bearer ${counterToken}` },
  });
  expect(accept.ok()).toBe(true);

  // 19. Printer Agent receives job.
  const poll = await apiRequest.get(`${API_BASE}/agents/jobs?wait=10`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  expect(poll.status()).toBe(200);
  const { id: jobId } = (await poll.json()) as { id: string };

  const claim = await apiRequest.post(`${API_BASE}/agents/jobs/${jobId}/claim`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  expect(claim.ok()).toBe(true);

  // 20. Agent securely obtains document -- a real authenticated,
  // decrypted download, proving the full envelope-encryption round
  // trip (§62) for this exact document, not a stub.
  const document = await apiRequest.get(`${API_BASE}/agents/jobs/${jobId}/document`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  expect(document.ok()).toBe(true);
  const documentBytes = await document.body();
  expect(documentBytes.subarray(0, 4).toString("latin1")).toBe("%PDF");

  // 21/22. Agent sends document to printer; printer prints. <-- The one
  // manual step (13.1's own Build line): the agent's own PDFium print
  // to a real, physically attached printer against the
  // bytes just downloaded above. Everything before and after this
  // point is genuinely automated against the real backend.

  // 23. Agent reports success. 24. Backend updates print status.
  const status = await apiRequest.post(`${API_BASE}/agents/jobs/${jobId}/status`, {
    headers: { Authorization: `Bearer ${agentToken}`, "Idempotency-Key": `${jobId}:PRINTED` },
    data: { status: "PRINTED" },
  });
  expect(status.ok()).toBe(true);
}

/** §121's own 31-step golden path, driven as one continuous run: real
 * browser automation (Playwright's own `page`) for every customer-
 * facing step against customer-web, real direct HTTP calls (no shop-
 * facing web UI exists in this system -- that's shop-mobile, an Expo
 * app Playwright can't drive) for every shop-staff and agent step,
 * against the real backend. Steps are numbered per §121's own list;
 * skipped numbers are steps with nothing to assert beyond what the
 * next step's own precondition already proves (e.g. #4/#5's PDF
 * validation and page-count detection are proven by #6's configure
 * screen successfully loading a real page count at all). */
test.describe("Golden path (§121, 13.1)", () => {
  test("upload through completion and retention deletion, in one uninterrupted run", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);

    // 1. Customer opens Print Automated.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Print Automated" })).toBeVisible();

    // 2. Customer logs in. Uses the seeded customer account (1.3), not
    // a fresh signup -- a real registration round trip is already
    // separately proven by auth-round-trip.spec.ts, and signup's own
    // rate limit (§85: 3/hr per IP, no per-account dimension the way
    // login's IP+email key gives every run its own bucket) is easily
    // exhausted by this same suite's own repeated local runs, exactly
    // the isolation gotcha 12.3's own rate-limit tests already hit for
    // the identical reason. Login has no such shared-bucket conflict.
    await page.goto("/login");
    await page.getByLabel("Email").fill("customer@print-automated.dev");
    await page.getByLabel("Password").fill("DevPassword123!");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });

    // 3. Customer uploads a PDF. 4/5. System validates it and detects
    // its page count (proven together: the configure screen below only
    // ever shows a real page count once processing genuinely reached
    // READY with a valid PDF).
    await page.goto("/upload");
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_PDF);
    await expect(page.getByRole("status")).toContainText("is ready.", { timeout: 30_000 });
    await page.getByRole("link", { name: "Configure print job" }).click();
    await expect(page).toHaveURL(/\/configure\?documentId=/, { timeout: 10_000 });
    const documentId = new URL(page.url()).searchParams.get("documentId");
    expect(documentId).not.toBeNull();

    // 6. Customer selects print settings. (Defaults -- B&W, single-
    // sided, all pages, 1 copy -- are already what §121's own scenario
    // needs; nothing to change here.)
    // 7. Customer selects an active shop.
    // A plain string (substring match), not `new RegExp(SHOP_NAME)`: the
    // shop's own name contains literal parentheses --
    // "(full-service)" -- which regex would read as a capturing group,
    // not literal characters to match against the button's real text.
    await page.getByRole("button", { name: SHOP_NAME }).click();

    // 8. Backend calculates price.
    await expect(page.getByText("Total")).toBeVisible({ timeout: 15_000 });
    const reviewButton = page.getByRole("button", { name: "Review order" });
    await expect(reviewButton).toBeEnabled();
    await reviewButton.click();
    await expect(page).toHaveURL(/\/review\?/, { timeout: 10_000 });
    const shopId = new URL(page.url()).searchParams.get("shopId");
    expect(shopId).not.toBeNull();

    // 9. Customer confirms checkout. 10. Customer pays.
    // Matches the URL's own path exactly (`new URL(...).pathname`), not
    // a substring: a plain `.includes("/api/orders")` also matches
    // `/api/orders/quote` (§4.4's own debounced re-quote endpoint,
    // still possibly in flight from the configure/review screens above)
    // -- its response has no `id` field, so destructuring one from it
    // silently yields `undefined`, a real bug this test's own first
    // draft had, caught by the GET /shop/orders/undefined 403 it
    // produced two steps later.
    const [createOrderResponse] = await Promise.all([
      page.waitForResponse(
        (res) => new URL(res.url()).pathname === "/api/orders" && res.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Pay & Place Order" }).click(),
    ]);
    const { id: orderId } = (await createOrderResponse.json()) as { id: string };

    // review/page.tsx does a full navigation to the mock provider's own
    // checkout page (6.3), a different origin from customer-web -- only
    // after its own sequential startCheckout() call completes, past the
    // default 5s assertion timeout under this suite's own load.
    await expect(page).toHaveURL(/\/payments\/mock\/checkout/, { timeout: 15_000 });
    // 11. Payment provider confirms payment. 12. Backend verifies
    // webhook. 13. Order becomes PAID -- all three happen inside this
    // one click: mock-checkout.controller.ts's own resolve() records
    // the event and synchronously delivers the real, HMAC-signed
    // webhook to the real /v1/webhooks/payment/mock endpoint before
    // this page finishes loading.
    await page.getByRole("link", { name: "Pay", exact: true }).click();
    await expect(page.getByText(/Recorded PAID/)).toBeVisible({ timeout: 10_000 });

    // 14. Shop receives order. 15. Counter employee opens order. 16.
    // Employee sees PAYMENT VERIFIED.
    const counterToken = await counterAccessToken(request);
    const shopOrder = await request.get(`${API_BASE}/shop/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${counterToken}` },
    });
    expect(shopOrder.ok()).toBe(true);
    const shopOrderBody = (await shopOrder.json()) as {
      orderStatus: string;
      paymentStatus: string;
    };
    expect(shopOrderBody.orderStatus).toBe("WAITING_FOR_SHOP");
    expect(shopOrderBody.paymentStatus).toBe("PAID");

    // 17-24: accept, agent claims/downloads/(manually prints), reports
    // success, backend updates status -- see actAsAgentAndPrint's own
    // comments for exactly which step is which.
    await actAsAgentAndPrint(request, counterToken, orderId, shopId!);

    // 25. Shop app displays printed status.
    const printedOrder = await request.get(`${API_BASE}/shop/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${counterToken}` },
    });
    expect((await printedOrder.json()).orderStatus).toBe("PRINTED");

    // 26. Staff marks order READY.
    const readyRes = await request.post(`${API_BASE}/shop/orders/${orderId}/ready`, {
      headers: { Authorization: `Bearer ${counterToken}` },
    });
    expect(readyRes.ok()).toBe(true);

    // 27. Customer sees READY FOR COLLECTION -- back in the real
    // browser, the customer's own still-logged-in session.
    await page.goto(`/orders/${orderId}`);
    const readyStep = page.locator("li", { hasText: "Ready for collection" });
    await expect(readyStep).toBeVisible({ timeout: 10_000 });
    await expect(readyStep.locator("span").first()).toHaveText("✓");

    // 28. Customer collects document -- a physical, offline action with
    // nothing for this system to assert; not automated, same as the
    // physical print step above.

    // 29. Staff marks COMPLETED. 30. Backend records completion.
    const completeRes = await request.post(`${API_BASE}/shop/orders/${orderId}/complete`, {
      headers: { Authorization: `Bearer ${counterToken}` },
    });
    expect(completeRes.ok()).toBe(true);
    expect((await completeRes.json()).orderStatus).toBe("COMPLETED");

    // 31. Temporary document copies are deleted according to retention
    // policy. §11.5's own DocumentDeletionService is what a scheduled
    // retention sweep AND this customer-initiated DELETE both call
    // (confirmed by reading documents.service.ts's own remove()) -- so
    // calling it here as the customer exercises the real deletion
    // mechanism this golden-path document actually goes through,
    // without waiting out a real multi-day retention window (already
    // separately proven on its own timing terms by
    // document-retention.e2e-spec.ts). page.request shares the
    // customer's own browser session cookies, the same auth this
    // customer used for every step above.
    const deleteRes = await page.request.delete(`/api/documents/${documentId}`);
    expect(deleteRes.ok()).toBe(true);
  });
});
