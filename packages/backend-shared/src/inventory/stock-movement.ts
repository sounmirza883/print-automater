import { HttpStatus } from "@nestjs/common";
import type { InventoryMovementType, Prisma } from "@prisma/client";
import { redactMetadata } from "../audit/redact-metadata.js";
import { AppException } from "../errors/app-exception.js";

/** Audit action written (in the same transaction) for every stock movement. */
export const INVENTORY_MOVEMENT_AUDIT_ACTION = "INVENTORY_MOVEMENT";

/** STRICT (default): a movement that would take stock below zero is refused
 * with 409 INSUFFICIENT_STOCK. CLAMP: for events that already happened
 * physically (paper WAS printed): take what is there, floor at zero, and
 * report the shortfall -- never fail the caller, never go negative. */
export type StockMode = "STRICT" | "CLAMP";

export interface StockMovementInput {
  shopId: string;
  itemId: string;
  type: InventoryMovementType;
  /** Signed, non-zero. */
  quantityDelta: number;
  mode?: StockMode;
  reason?: string | null;
  actorId?: string | null;
  printJobId?: string | null;
  /** Unique per logical operation (`consumption:<jobId>:<itemId>`,
   * `po-receipt:<lineId>`): a replay is reported as DUPLICATE and changes
   * nothing. */
  idempotencyKey?: string | null;
  /** Extra fields for the audit row (redacted like every audit row). */
  auditMetadata?: Record<string, unknown>;
}

export type StockMovementResult =
  | {
      outcome: "APPLIED";
      movementId: string;
      quantityBefore: number;
      quantityAfter: number;
      /** Signed; equals the request unless CLAMP reduced it. */
      appliedDelta: number;
      /** Units requested but not available (CLAMP only), else 0. */
      shortfall: number;
    }
  | { outcome: "DUPLICATE"; movementId: string; quantityAfter: number }
  /** CLAMP with nothing in stock: no movement exists (a zero delta is not a
   * movement); `shortfall` is the whole request. */
  | { outcome: "NOTHING_TO_APPLY"; quantityAfter: number; shortfall: number };

/** 20.2 / PRD 100. THE only place `inventory_items.quantity` is written.
 *
 * Concurrency: the item row is locked with `SELECT .. FOR UPDATE` first, so
 * concurrent movements on one item serialise; the decision (sufficient stock?
 * replay?) is made from the locked, current value; and the write itself is an
 * atomic relative UPDATE (`quantity = quantity + delta`), never an absolute
 * value computed outside the lock. The `inventory_items_quantity_non_negative`
 * CHECK is the last line of defence. Lock order for callers that hold other
 * locks: `orders` -> `print_jobs` -> `inventory_items` (ascending id when
 * several); purchase orders -> `inventory_items` (ascending id).
 *
 * The idempotency check happens AFTER the lock: two concurrent replays of one
 * key serialise, and the second sees the first's committed movement and returns
 * DUPLICATE instead of colliding on the unique index (which would abort the
 * whole transaction). The movement row and its audit row commit or roll back
 * with the stock change, in the caller's transaction. */
export async function applyStockMovement(
  tx: Prisma.TransactionClient,
  input: StockMovementInput,
): Promise<StockMovementResult> {
  if (!Number.isInteger(input.quantityDelta) || input.quantityDelta === 0) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      "INVALID_STOCK_DELTA",
      "A stock movement must change the quantity by a non-zero whole number.",
      false,
    );
  }
  const mode = input.mode ?? "STRICT";

  const locked = await tx.$queryRaw<Array<{ quantity: number }>>`
    SELECT quantity FROM inventory_items
    WHERE id = ${input.itemId} AND shop_id = ${input.shopId}
    FOR UPDATE
  `;
  const current = locked[0];
  if (!current) {
    throw new AppException(
      HttpStatus.NOT_FOUND,
      "INVENTORY_ITEM_NOT_FOUND",
      "Inventory item not found.",
      false,
    );
  }

  if (input.idempotencyKey) {
    const existing = await tx.inventoryMovement.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, quantityAfter: true },
    });
    if (existing) {
      return {
        outcome: "DUPLICATE",
        movementId: existing.id,
        quantityAfter: existing.quantityAfter,
      };
    }
  }

  let appliedDelta = input.quantityDelta;
  let shortfall = 0;
  if (current.quantity + appliedDelta < 0) {
    if (mode === "STRICT") {
      throw new AppException(
        HttpStatus.CONFLICT,
        "INSUFFICIENT_STOCK",
        `Only ${current.quantity} in stock; cannot remove ${-appliedDelta}.`,
        false,
      );
    }
    appliedDelta = -current.quantity;
    shortfall = -input.quantityDelta - current.quantity;
  }
  if (appliedDelta === 0) {
    return { outcome: "NOTHING_TO_APPLY", quantityAfter: current.quantity, shortfall };
  }

  const updated = await tx.$queryRaw<Array<{ quantity: number }>>`
    UPDATE inventory_items
    SET quantity = quantity + ${appliedDelta}, updated_at = now()
    WHERE id = ${input.itemId}
    RETURNING quantity
  `;
  const quantityAfter = updated[0]!.quantity;

  const movement = await tx.inventoryMovement.create({
    data: {
      shopId: input.shopId,
      inventoryItemId: input.itemId,
      type: input.type,
      quantityDelta: appliedDelta,
      quantityAfter,
      reason: input.reason ?? null,
      actorId: input.actorId ?? null,
      printJobId: input.printJobId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    },
  });

  await tx.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: INVENTORY_MOVEMENT_AUDIT_ACTION,
      resourceType: "inventory_item",
      resourceId: input.itemId,
      metadata: redactMetadata({
        shopId: input.shopId,
        movementId: movement.id,
        type: input.type,
        quantityDelta: appliedDelta,
        quantityAfter,
        reason: input.reason ?? null,
        printJobId: input.printJobId ?? null,
        ...(shortfall > 0 ? { shortfall, requestedDelta: input.quantityDelta } : {}),
        ...input.auditMetadata,
      }) as Prisma.InputJsonValue,
    },
  });

  return {
    outcome: "APPLIED",
    movementId: movement.id,
    quantityBefore: current.quantity,
    quantityAfter,
    appliedDelta,
    shortfall,
  };
}
