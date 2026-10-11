import { randomUUID } from "node:crypto";
import { ForbiddenException, HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, UserRole, type PaymentProofStatus } from "@prisma/client";
import {
  AppException,
  PrismaService,
  StorageService,
  redactMetadata,
} from "@print-automated/backend-shared";
import type {
  BillingPlanOption,
  PaymentInstructionsResponse,
  PaymentProofListResponse,
  PaymentProofResponse,
} from "@print-automated/types";
import type {
  AdminListPaymentProofsQueryInput,
  ApprovePaymentProofInput,
  RejectPaymentProofInput,
  SubmitPaymentProofInput,
} from "@print-automated/validation";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import { sanitizeFilename } from "../documents/sanitize-filename.js";
import { NotificationService } from "../notifications/notification.service.js";
import {
  planDefinitionArchived,
  planDefinitionNotFound,
} from "../shop-plan/plan-definition.service.js";
import { ShopPlanService } from "../shop-plan/shop-plan.service.js";
import { decodeProofFile } from "./proof-file.js";

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

const WITH_NAMES = {
  shop: { select: { name: true } },
  planDefinition: { select: { name: true } },
} satisfies Prisma.PaymentProofInclude;

type ProofRow = Prisma.PaymentProofGetPayload<{ include: typeof WITH_NAMES }>;

const NOT_FOUND = (): AppException =>
  new AppException(
    HttpStatus.NOT_FOUND,
    "PAYMENT_PROOF_NOT_FOUND",
    "No such payment proof.",
    false,
  );

const ALREADY_REVIEWED = (): AppException =>
  new AppException(
    HttpStatus.CONFLICT,
    "PAYMENT_PROOF_ALREADY_REVIEWED",
    "This payment proof has already been reviewed.",
    false,
  );

const PENDING_EXISTS = (): AppException =>
  new AppException(
    HttpStatus.CONFLICT,
    "PAYMENT_PROOF_PENDING_EXISTS",
    "A payment proof for this business is already waiting for review.",
    false,
  );

const INVALID_FILE = (message: string): AppException =>
  new AppException(HttpStatus.BAD_REQUEST, "PAYMENT_PROOF_INVALID_FILE", message, false);

const CONTACT_ONLY_PLAN = (name: string): AppException =>
  new AppException(
    HttpStatus.BAD_REQUEST,
    "PLAN_CONTACT_ONLY",
    `The plan "${name}" has custom pricing. Contact us to arrange payment.`,
    false,
  );

function toResponse(row: ProofRow, duplicateTransactionRef: boolean): PaymentProofResponse {
  return {
    id: row.id,
    shopId: row.shopId,
    shopName: row.shop.name,
    planDefinitionId: row.planDefinitionId,
    planName: row.planDefinition.name,
    amountMinor: row.amountMinor,
    currency: row.currency,
    transactionRef: row.transactionRef,
    fileName: row.fileName,
    fileContentType: row.fileContentType,
    fileSize: row.fileSize,
    status: row.status,
    submittedByUserId: row.submittedByUserId,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
    grantedMonths: row.grantedMonths,
    duplicateTransactionRef,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ProofFile {
  bytes: Buffer;
  contentType: string;
  fileName: string;
}

/** Manual plan billing. An owner pays the platform off-app and submits proof; a platform
 * admin approves it (granting N calendar months via `ShopPlanService.activateInTx`, in the
 * SAME transaction as the status change) or rejects it. Proof files are written to storage
 * once and never deleted -- rejected proofs keep their file too. */
@Injectable()
export class PaymentProofsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly shopMembership: ShopMembershipService,
    private readonly shopPlan: ShopPlanService,
    private readonly notifications: NotificationService,
  ) {}

  // ---- owner ----------------------------------------------------------------

  /** `@ShopScopedField` does not prove real membership (see ShopPlanService.getStatus), so
   * every owner-side method re-checks it here -- and requires the OWNER role at this
   * specific shop, not merely any staff role. */
  private async assertOwner(shopId: string, userId: string): Promise<void> {
    const role = await this.shopMembership.getEffectiveRole(shopId, userId);
    if (role !== UserRole.SHOP_OWNER) {
      throw new ForbiddenException("Only the business owner can manage plan payments.");
    }
  }

  async submit(dto: SubmitPaymentProofInput, userId: string): Promise<PaymentProofResponse> {
    await this.assertOwner(dto.shopId, userId);

    const decoded = decodeProofFile(dto.fileBase64, dto.fileContentType);
    if (!decoded.ok) {
      throw INVALID_FILE(
        decoded.reason === "TOO_LARGE"
          ? "The file is larger than 5 MB."
          : decoded.reason === "EMPTY"
            ? "The file is empty."
            : "The file does not match its declared type. Upload a JPEG, PNG or PDF.",
      );
    }

    const plan = await this.prisma.planDefinition.findUnique({
      where: { id: dto.planDefinitionId },
    });
    if (!plan) {
      throw planDefinitionNotFound();
    }
    if (plan.archived) {
      throw planDefinitionArchived(plan.name);
    }
    if (plan.contactOnly) {
      throw CONTACT_ONLY_PLAN(plan.name);
    }

    const id = randomUUID();
    const fileKey = this.storage.paymentProofKey(id);
    const fileName = sanitizeFilename(dto.fileName);

    let created: ProofRow;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.paymentProof.create({
          data: {
            id,
            shopId: dto.shopId,
            submittedByUserId: userId,
            planDefinitionId: plan.id,
            amountMinor: dto.amountMinor,
            currency: plan.currency,
            transactionRef: dto.transactionRef,
            fileKey,
            fileName,
            fileContentType: dto.fileContentType,
            fileSize: decoded.bytes.length,
          },
          include: WITH_NAMES,
        });
        await this.audit(tx, userId, AuditAction.PAYMENT_PROOF_SUBMITTED, id, {
          shopId: dto.shopId,
          planDefinitionId: plan.id,
          amountMinor: dto.amountMinor,
          currency: plan.currency,
          transactionRef: dto.transactionRef,
        });
        // Last, inside the transaction: if the upload fails, the row rolls back and no
        // pending proof is left pointing at a missing file.
        await this.storage.putObjectBuffer(fileKey, decoded.bytes, dto.fileContentType);
        return row;
      }, TX_OPTIONS);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw PENDING_EXISTS();
      }
      throw error;
    }

    return toResponse(created, await this.isDuplicateRef(created.id, created.transactionRef));
  }

  /** The plans an owner can pay for, cheapest first within the admin's display order. */
  async listPlans(): Promise<{ items: BillingPlanOption[] }> {
    const plans = await this.prisma.planDefinition.findMany({
      where: { archived: false, contactOnly: false },
      orderBy: [{ sortOrder: "asc" }, { priceMinor: "asc" }, { name: "asc" }],
    });
    return {
      items: plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        priceMinor: plan.priceMinor,
        currency: plan.currency,
        billingPeriodDays: plan.billingPeriodDays,
        annualPriceMinor: plan.annualPriceMinor,
      })),
    };
  }

  async listForShop(shopId: string, userId: string): Promise<PaymentProofResponse[]> {
    await this.assertOwner(shopId, userId);
    const rows = await this.prisma.paymentProof.findMany({
      where: { shopId },
      include: WITH_NAMES,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    // An owner's own history never exposes other businesses' references.
    return rows.map((row) => toResponse(row, false));
  }

  async getFileForShop(shopId: string, proofId: string, userId: string): Promise<ProofFile> {
    await this.assertOwner(shopId, userId);
    const row = await this.prisma.paymentProof.findFirst({ where: { id: proofId, shopId } });
    if (!row) {
      throw NOT_FOUND();
    }
    return this.readFile(row);
  }

  // ---- admin ----------------------------------------------------------------

  async adminList(query: AdminListPaymentProofsQueryInput): Promise<PaymentProofListResponse> {
    const where: Prisma.PaymentProofWhereInput = query.status ? { status: query.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.paymentProof.findMany({
        where,
        include: WITH_NAMES,
        // Oldest first: the review queue is worked in submission order.
        orderBy: { createdAt: query.status === "PENDING" ? "asc" : "desc" },
        take: query.take,
        skip: query.skip,
      }),
      this.prisma.paymentProof.count({ where }),
    ]);
    const duplicates = await this.duplicateRefs(rows.map((row) => row.transactionRef));
    return {
      items: rows.map((row) => toResponse(row, duplicates.has(row.transactionRef))),
      total,
      limit: query.take,
      offset: query.skip,
    };
  }

  async adminGet(id: string): Promise<PaymentProofResponse> {
    const row = await this.prisma.paymentProof.findUnique({ where: { id }, include: WITH_NAMES });
    if (!row) {
      throw NOT_FOUND();
    }
    return toResponse(row, await this.isDuplicateRef(row.id, row.transactionRef));
  }

  async adminGetFile(id: string): Promise<ProofFile> {
    const row = await this.prisma.paymentProof.findUnique({ where: { id } });
    if (!row) {
      throw NOT_FOUND();
    }
    return this.readFile(row);
  }

  /** One transaction: lock the proof row, require PENDING, grant the months, mark it
   * APPROVED. A second approve/reject on the same proof is a 409, never a double grant. */
  async approve(
    id: string,
    adminUserId: string,
    dto: ApprovePaymentProofInput,
  ): Promise<PaymentProofResponse> {
    const result = await this.prisma.$transaction(async (tx) => {
      const proof = await this.lockPending(tx, id);
      const planDefinitionId = dto.planDefinitionId ?? proof.plan_definition_id;
      const plan = await this.shopPlan.activateInTx(
        tx,
        proof.shop_id,
        adminUserId,
        planDefinitionId,
        {
          months: dto.months,
        },
      );
      const row = await tx.paymentProof.update({
        where: { id },
        data: {
          status: "APPROVED" satisfies PaymentProofStatus,
          reviewedByUserId: adminUserId,
          reviewedAt: new Date(),
          grantedMonths: dto.months,
        },
        include: WITH_NAMES,
      });
      await this.audit(tx, adminUserId, AuditAction.PAYMENT_PROOF_APPROVED, id, {
        shopId: proof.shop_id,
        planDefinitionId,
        months: dto.months,
        newExpiresAt: plan.expiresAt,
      });
      return { row, planName: plan.plan?.name ?? row.planDefinition.name, plan, proof };
    }, TX_OPTIONS);

    await this.notifySubmitter(result.proof.submitted_by_user_id, result.row.shop.name, {
      approved: true,
      planName: result.planName,
      months: dto.months,
      expiresAt: new Date(result.plan.expiresAt ?? Date.now()),
    });
    return toResponse(result.row, await this.isDuplicateRef(id, result.row.transactionRef));
  }

  async reject(
    id: string,
    adminUserId: string,
    dto: RejectPaymentProofInput,
  ): Promise<PaymentProofResponse> {
    const result = await this.prisma.$transaction(async (tx) => {
      const proof = await this.lockPending(tx, id);
      const row = await tx.paymentProof.update({
        where: { id },
        data: {
          status: "REJECTED" satisfies PaymentProofStatus,
          reviewedByUserId: adminUserId,
          reviewedAt: new Date(),
          rejectionReason: dto.reason,
        },
        include: WITH_NAMES,
      });
      await this.audit(tx, adminUserId, AuditAction.PAYMENT_PROOF_REJECTED, id, {
        shopId: proof.shop_id,
        reason: dto.reason,
      });
      return { row, proof };
    }, TX_OPTIONS);

    await this.notifySubmitter(result.proof.submitted_by_user_id, result.row.shop.name, {
      approved: false,
      reason: dto.reason,
    });
    return toResponse(result.row, await this.isDuplicateRef(id, result.row.transactionRef));
  }

  // ---- payment instructions ------------------------------------------------

  async getInstructions(): Promise<PaymentInstructionsResponse> {
    const row = await this.prisma.platformSettings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
    return { paymentInstructions: row.paymentInstructions, updatedAt: row.updatedAt.toISOString() };
  }

  async updateInstructions(
    adminUserId: string,
    paymentInstructions: string,
  ): Promise<PaymentInstructionsResponse> {
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.platformSettings.upsert({
        where: { id: 1 },
        update: { paymentInstructions, updatedByUserId: adminUserId },
        create: { id: 1, paymentInstructions, updatedByUserId: adminUserId },
      });
      await tx.auditLog.create({
        data: {
          actorId: adminUserId,
          action: AuditAction.PAYMENT_INSTRUCTIONS_UPDATED,
          resourceType: "platform_settings",
          resourceId: "1",
          metadata: redactMetadata({ length: paymentInstructions.length }) as Prisma.InputJsonValue,
        },
      });
      return updated;
    }, TX_OPTIONS);
    return { paymentInstructions: row.paymentInstructions, updatedAt: row.updatedAt.toISOString() };
  }

  // ---- internals -------------------------------------------------------------

  private async lockPending(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<{
    shop_id: string;
    plan_definition_id: string;
    submitted_by_user_id: string;
  }> {
    const locked = await tx.$queryRaw<
      Array<{
        status: string;
        shop_id: string;
        plan_definition_id: string;
        submitted_by_user_id: string;
      }>
    >`
      SELECT status::text AS status, shop_id, plan_definition_id, submitted_by_user_id
      FROM payment_proofs WHERE id = ${id} FOR UPDATE
    `;
    const proof = locked[0];
    if (!proof) {
      throw NOT_FOUND();
    }
    if (proof.status !== "PENDING") {
      throw ALREADY_REVIEWED();
    }
    return proof;
  }

  private async readFile(row: {
    fileKey: string;
    fileContentType: string;
    fileName: string;
  }): Promise<ProofFile> {
    return {
      bytes: await this.storage.getObjectBuffer(row.fileKey),
      contentType: row.fileContentType,
      fileName: row.fileName,
    };
  }

  private async isDuplicateRef(id: string, transactionRef: string): Promise<boolean> {
    const other = await this.prisma.paymentProof.count({
      where: { transactionRef, id: { not: id } },
    });
    return other > 0;
  }

  /** Which of these references appear on more than one proof platform-wide. */
  private async duplicateRefs(refs: string[]): Promise<Set<string>> {
    if (refs.length === 0) {
      return new Set();
    }
    const groups = await this.prisma.paymentProof.groupBy({
      by: ["transactionRef"],
      where: { transactionRef: { in: refs } },
      _count: { _all: true },
    });
    return new Set(groups.filter((g) => g._count._all > 1).map((g) => g.transactionRef));
  }

  /** Best effort: the decision is already committed, and a mail-queue hiccup must not
   * turn a successful approve/reject into an error response. */
  private async notifySubmitter(
    userId: string,
    shopName: string,
    decision: Parameters<NotificationService["sendPaymentProofDecision"]>[2],
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (user) {
        await this.notifications.sendPaymentProofDecision(user.email, shopName, decision);
      }
    } catch {
      // Intentionally swallowed -- see above.
    }
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actorId: string,
    action: string,
    proofId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId,
        action,
        resourceType: "payment_proof",
        resourceId: proofId,
        metadata: redactMetadata(metadata) as Prisma.InputJsonValue,
      },
    });
  }
}
