import { Controller, Get, Inject, NotFoundException, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import type { ApiEnv } from "@print-automated/config";
import { API_ENV } from "../config/config.module.js";
import { MockPaymentProvider } from "./mock-payment-provider.js";
import type { ProviderPaymentOutcome } from "./payment-provider.interface.js";

const OUTCOMES: ProviderPaymentOutcome[] = ["PAID", "FAILED", "CANCELLED"];

/** §23/6.3's dev-only checkout page. A real PSP hands the customer's
 * browser off to *its own* hosted checkout; the mock provider's
 * equivalent is this controller, entirely owned by this codebase --
 * so it can offer the one thing a real checkout page never would:
 * Pay/Fail/Abandon buttons that deliberately choose the outcome. Every
 * link here is a plain GET (no JS, no form, no CSRF token) -- an
 * unusual choice for a state-changing action, deliberate for a
 * throwaway dev tool where "click a link" needs to be the entire UI. */
@Controller("payments/mock")
export class MockCheckoutController {
  constructor(
    private readonly provider: MockPaymentProvider,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get("checkout")
  checkout(
    @Query("providerPaymentId") providerPaymentId: string,
    @Query("orderId") orderId: string,
    @Query("amountMinor") amountMinor: string,
    @Query("currency") currency: string,
    @Res() res: Response,
  ): void {
    const params = new URLSearchParams({ providerPaymentId });
    const links = OUTCOMES.map((outcome) => {
      const href = `resolve?${new URLSearchParams({ providerPaymentId, outcome }).toString()}`;
      const label = outcome === "PAID" ? "Pay" : outcome === "FAILED" ? "Fail" : "Abandon";
      return `<a href="${href}">${label}</a>`;
    }).join(" | ");

    res.type("html").send(`<!doctype html>
<html><body>
<h1>Mock checkout</h1>
<p>Order ${escapeHtml(orderId)} -- ${escapeHtml(amountMinor)} ${escapeHtml(currency)} minor units</p>
<p>Payment ${escapeHtml(providerPaymentId)}</p>
<p>${links}</p>
<p><a href="replay?${params.toString()}">Replay last webhook</a></p>
</body></html>`);
  }

  @Get("resolve")
  async resolve(
    @Query("providerPaymentId") providerPaymentId: string,
    @Query("outcome") outcome: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!isOutcome(outcome)) {
      res
        .status(400)
        .type("html")
        .send(`<!doctype html><p>Unknown outcome: ${escapeHtml(outcome)}</p>`);
      return;
    }

    const entry = this.provider.recordEvent(providerPaymentId, outcome);
    const delivery = await this.deliver(entry.rawBody, entry.signature);

    res
      .type("html")
      .send(
        `<!doctype html><p>Recorded ${outcome} for ${escapeHtml(providerPaymentId)}. Webhook delivery: ${delivery}</p>`,
      );
  }

  @Get("replay")
  async replay(
    @Query("providerPaymentId") providerPaymentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const entry = this.provider.lastEvent(providerPaymentId);
    if (!entry) {
      throw new NotFoundException("No prior event to replay for this payment.");
    }

    // The exact same bytes and signature as the original delivery --
    // a true replay, not a freshly (re-)signed equivalent -- proving
    // whatever receives this can't tell it apart from a real PSP
    // retrying an already-delivered webhook.
    const delivery = await this.deliver(entry.rawBody, entry.signature);
    res.type("html").send(`<!doctype html><p>Replayed. Webhook delivery: ${delivery}</p>`);
  }

  private async deliver(rawBody: Buffer, signature: string): Promise<string> {
    const url = `${this.env.API_PUBLIC_BASE_URL}/v1/webhooks/payment/mock`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-mock-signature": signature },
        body: rawBody,
      });
      return `${response.status}`;
    } catch (error) {
      // §6.5 doesn't exist until its own sub-phase -- until then this
      // is an expected, informative failure (there's nothing listening
      // yet), not something to crash the checkout page over.
      return `delivery failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

function isOutcome(value: string): value is ProviderPaymentOutcome {
  return (OUTCOMES as string[]).includes(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
