import { Inject, Logger } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { PaymentStatus } from "@prisma/client";
import { PrismaService, QUEUE_NAMES } from "@print-automated/backend-shared";
import type { ApiEnv } from "@print-automated/config";
import { API_ENV } from "../config/config.module.js";
import { PAYMENT_PROVIDER, type PaymentProvider } from "../payments/payment-provider.interface.js";

/** 11.4's own comparable local statuses -- REFUND_PENDING/REFUNDED/
 * REFUND_FAILED have no counterpart in `ProviderPaymentOutcome`
 * (refund state is tracked through `provider.refund()`'s own return
 * value, not `fetchPayment()`), and AUTHORIZED is a §57 sketch value
 * no code path in this codebase actually writes -- reconciling either
 * would mean inventing behavior for a comparison the provider
 * interface was never designed to answer. */
const COMPARABLE_STATUSES = [
  PaymentStatus.PENDING,
  PaymentStatus.PAID,
  PaymentStatus.FAILED,
  PaymentStatus.CANCELLED,
] as const;

const OUTCOME_TO_STATUS: Record<string, PaymentStatus> = {
  PENDING: PaymentStatus.PENDING,
  PAID: PaymentStatus.PAID,
  FAILED: PaymentStatus.FAILED,
  CANCELLED: PaymentStatus.CANCELLED,
};

/** 11.4: "scheduled comparison of local payment state against provider
 * state, flagging divergence rather than auto-correcting money." This
 * processor never calls `prisma.payment.update()` or touches an order's
 * own status at all -- by construction, not by convention, there is no
 * code path here that could silently rewrite money. A divergence is
 * recorded as data (an audit row, the same durable, queryable record
 * every other sensitive action in this codebase already produces) and
 * logged at error level so 12.5's eventual observability/alerting can
 * pick it up; resolving it is a human, out-of-band action, deliberately
 * outside this sweep's own authority.
 *
 * Deliberately lives in services/api, not services/worker (unlike
 * 5.6/9.4/10.5's own sweeps) -- MockPaymentProvider's ledger
 * (mock-payment-provider.ts) is real, per-process, in-memory state.
 * Running this in a separate worker process would mean it always saw
 * every payment as PENDING (its own instance's ledger would never have
 * received the `recordEvent()` calls the API process's checkout/webhook
 * flow makes), which would make 11.4's own Done-when -- "an artificially
 * desynchronized payment is flagged" -- untestable and, worse, silently
 * wrong: every real payment would look divergent from a fresh sweep
 * that never saw it change. Sharing the exact same PAYMENT_PROVIDER
 * instance sidesteps that entirely; a real PSP integration later
 * wouldn't have this constraint (its own API is a genuine external
 * source of truth reachable identically from either process), but
 * nothing here needs to move once that happens either. */
@Processor(QUEUE_NAMES.PAYMENT_RECONCILIATION)
export class PaymentReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentReconciliationProcessor.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ checkedCount: number; divergentCount: number }> {
    const cutoff = new Date(Date.now() - this.env.PAYMENT_RECONCILIATION_GRACE_MINUTES * 60_000);
    const payments = await this.prisma.payment.findMany({
      where: {
        providerPaymentId: { not: null },
        status: { in: [...COMPARABLE_STATUSES] },
        updatedAt: { lt: cutoff },
      },
      select: { id: true, orderId: true, providerPaymentId: true, status: true },
    });

    let divergentCount = 0;
    for (const payment of payments) {
      const remote = await this.provider.fetchPayment(payment.providerPaymentId!);
      const expectedLocalStatus = OUTCOME_TO_STATUS[remote.outcome];
      if (expectedLocalStatus === payment.status) {
        continue;
      }

      divergentCount += 1;
      this.logger.error(
        {
          paymentId: payment.id,
          orderId: payment.orderId,
          localStatus: payment.status,
          providerOutcome: remote.outcome,
        },
        "payment reconciliation divergence detected",
      );
      await this.prisma.auditLog.create({
        data: {
          actorId: null,
          action: "PAYMENT_RECONCILIATION_DIVERGENCE",
          resourceType: "payment",
          resourceId: payment.id,
          metadata: {
            orderId: payment.orderId,
            localStatus: payment.status,
            providerOutcome: remote.outcome,
          },
        },
      });
    }

    if (divergentCount > 0) {
      this.logger.warn(
        `Payment reconciliation sweep: ${divergentCount}/${payments.length} payment(s) flagged as divergent.`,
      );
    }
    return { checkedCount: payments.length, divergentCount };
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(`Payment reconciliation sweep (job ${job?.id}) failed: ${error.message}`);
  }
}
