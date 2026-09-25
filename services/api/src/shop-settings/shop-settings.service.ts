import { isDeepStrictEqual } from "node:util";
import { ForbiddenException, HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, type Shop, type ShopSettings } from "@prisma/client";
import { Permission } from "@print-automated/types";
import {
  AUTOMATION_SETTING_KEYS,
  BUSINESS_SETTING_KEYS,
  type NotificationSettings,
  type OperatingHours,
  type UpdateShopSettingsInput,
} from "@print-automated/validation";
import {
  AppException,
  PrismaService,
  ROLE_PERMISSIONS,
  redactMetadata,
} from "@print-automated/backend-shared";
import { AgentJobsService } from "../agents/agent-jobs.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";

/** The single settings surface (22.1). Flat on purpose: a client edits by
 * sending back the keys it changed. The last four keys live on `shops`. */
export interface ShopSettingsResponse {
  shopId: string;
  /** Optimistic-concurrency token: send it back as `expectedVersion`. */
  version: number;
  updatedAt: Date;
  currency: string;
  taxRateBasisPoints: number | null;
  operatingHours: OperatingHours | null;
  notificationSettings: NotificationSettings;
  autoPrinterAssignmentEnabled: boolean;
  autoOperatorAssignmentEnabled: boolean;
  autoQueueManagementEnabled: boolean;
  inventoryAlertsEnabled: boolean;
  automaticNotificationsEnabled: boolean;
  pageLimitEnforcementEnabled: boolean;
  autoFailoverEnabled: boolean;
  inventoryTrackingEnabled: boolean;
  qualityCheckEnabled: boolean;
  multiItemEnabled: boolean;
}

type SettingKey = (typeof BUSINESS_SETTING_KEYS)[number] | (typeof AUTOMATION_SETTING_KEYS)[number];
const SHOP_FLAG_KEYS = [
  "autoFailoverEnabled",
  "inventoryTrackingEnabled",
  "qualityCheckEnabled",
  "multiItemEnabled",
] as const;
const ALL_KEYS: readonly SettingKey[] = [...BUSINESS_SETTING_KEYS, ...AUTOMATION_SETTING_KEYS];

function isShopFlag(key: string): key is (typeof SHOP_FLAG_KEYS)[number] {
  return (SHOP_FLAG_KEYS as readonly string[]).includes(key);
}

function toResponse(shop: Shop, row: ShopSettings): ShopSettingsResponse {
  return {
    shopId: row.shopId,
    version: row.version,
    updatedAt: row.updatedAt,
    currency: row.currency,
    taxRateBasisPoints: row.taxRateBasisPoints,
    operatingHours: (row.operatingHours as OperatingHours | null) ?? null,
    notificationSettings: row.notificationSettings as unknown as NotificationSettings,
    autoPrinterAssignmentEnabled: row.autoPrinterAssignmentEnabled,
    autoOperatorAssignmentEnabled: row.autoOperatorAssignmentEnabled,
    autoQueueManagementEnabled: row.autoQueueManagementEnabled,
    inventoryAlertsEnabled: row.inventoryAlertsEnabled,
    automaticNotificationsEnabled: row.automaticNotificationsEnabled,
    pageLimitEnforcementEnabled: row.pageLimitEnforcementEnabled,
    autoFailoverEnabled: shop.autoFailoverEnabled,
    inventoryTrackingEnabled: shop.inventoryTrackingEnabled,
    qualityCheckEnabled: shop.qualityCheckEnabled,
    multiItemEnabled: shop.multiItemEnabled,
  };
}

export interface UpdateSettingsOptions {
  /** The route already authorised exactly this one flag (the legacy
   * `PUT inventory/settings`, MANAGE_INVENTORY), so the per-group check is skipped
   * and that route keeps its own audit row and recovery side effect. */
  viaInventoryAlias?: boolean;
}

@Injectable()
export class ShopSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
    private readonly agentJobs: AgentJobsService,
  ) {}

  async get(shopId: string, userId: string): Promise<ShopSettingsResponse> {
    await this.assertMember(shopId, userId);
    const [shop, row] = await Promise.all([
      this.prisma.shop.findUniqueOrThrow({ where: { id: shopId } }),
      this.prisma.shopSettings.findUniqueOrThrow({ where: { shopId } }),
    ]);
    return toResponse(shop, row);
  }

  /** Every write goes through here. Lock order is shops, then shop_settings: the
   * same order every reader that needs both (recovery guards) uses, so a writer
   * and a reader can never deadlock. FOR NO KEY UPDATE on shops is enough to
   * conflict with readers' FOR SHARE without blocking FK inserts of
   * printers/orders for the shop. */
  async update(
    input: UpdateShopSettingsInput,
    userId: string,
    options: UpdateSettingsOptions = {},
  ): Promise<ShopSettingsResponse> {
    await this.assertMember(input.shopId, userId);
    const patch = ALL_KEYS.filter((key) => input[key] !== undefined);
    if (!options.viaInventoryAlias) {
      await this.assertMayChange(input.shopId, userId, patch);
    }

    const outcome = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM shops WHERE id = ${input.shopId} FOR NO KEY UPDATE`;
        let locked = await tx.$queryRaw<Array<{ version: number }>>`
          SELECT version FROM shop_settings WHERE shop_id = ${input.shopId} FOR UPDATE
        `;
        if (locked.length === 0) {
          // Defensive: the trigger creates the row with the shop.
          await tx.$executeRaw`
            INSERT INTO shop_settings (shop_id) VALUES (${input.shopId}) ON CONFLICT DO NOTHING
          `;
          locked = await tx.$queryRaw<Array<{ version: number }>>`
            SELECT version FROM shop_settings WHERE shop_id = ${input.shopId} FOR UPDATE
          `;
        }
        const current = locked[0]!.version;
        if (input.expectedVersion !== undefined && input.expectedVersion !== current) {
          throw new AppException(
            HttpStatus.CONFLICT,
            "SETTINGS_VERSION_CONFLICT",
            `The settings changed since you loaded them (now version ${current}). Reload and retry.`,
            false,
          );
        }

        const [shop, row] = await Promise.all([
          tx.shop.findUniqueOrThrow({ where: { id: input.shopId } }),
          tx.shopSettings.findUniqueOrThrow({ where: { shopId: input.shopId } }),
        ]);
        const before = toResponse(shop, row);

        const next: Record<string, unknown> = {};
        for (const key of patch) {
          const value =
            key === "notificationSettings"
              ? { ...before.notificationSettings, ...input.notificationSettings }
              : input[key];
          if (!isDeepStrictEqual(value, before[key])) {
            next[key] = value;
          }
        }
        const changedKeys = Object.keys(next);
        if (changedKeys.length === 0) {
          return { response: before, after: before, changedTracking: false };
        }

        const shopData: Prisma.ShopUpdateInput = {};
        const settingsData: Prisma.ShopSettingsUpdateInput = { version: { increment: 1 } };
        for (const key of changedKeys) {
          if (isShopFlag(key)) {
            shopData[key] = next[key] as boolean;
          } else if (key === "operatingHours") {
            settingsData.operatingHours =
              next[key] === null ? Prisma.DbNull : (next[key] as Prisma.InputJsonValue);
          } else if (key === "notificationSettings") {
            settingsData.notificationSettings = next[key] as Prisma.InputJsonValue;
          } else {
            (settingsData as Record<string, unknown>)[key] = next[key];
          }
        }
        const newShop =
          Object.keys(shopData).length > 0
            ? await tx.shop.update({ where: { id: input.shopId }, data: shopData })
            : shop;
        const newRow = await tx.shopSettings.update({
          where: { shopId: input.shopId },
          data: settingsData,
        });
        const after = toResponse(newShop, newRow);

        const pick = (source: ShopSettingsResponse): Record<string, unknown> =>
          Object.fromEntries(changedKeys.map((key) => [key, source[key as SettingKey]]));
        await tx.auditLog.create({
          data: {
            actorId: userId,
            action: AuditAction.SHOP_SETTINGS_CHANGED,
            resourceType: "shop",
            resourceId: input.shopId,
            metadata: redactMetadata({
              changedKeys,
              before: pick(before),
              after: pick(after),
              fromVersion: before.version,
              toVersion: after.version,
            }) as Prisma.InputJsonValue,
          },
        });
        const changedTracking = changedKeys.includes("inventoryTrackingEnabled");
        if (changedTracking && !options.viaInventoryAlias) {
          await tx.auditLog.create({
            data: {
              actorId: userId,
              action: AuditAction.INVENTORY_TRACKING_CHANGED,
              resourceType: "shop",
              resourceId: input.shopId,
              metadata: { enabled: after.inventoryTrackingEnabled },
            },
          });
        }
        return { response: after, after, changedTracking };
      },
      { maxWait: 10_000, timeout: 10_000 },
    );

    if (
      outcome.changedTracking &&
      !options.viaInventoryAlias &&
      outcome.after.inventoryTrackingEnabled === false
    ) {
      // The paper gate is released: NO_PAPER jobs are no longer blocked by anything.
      await this.agentJobs.recoverPaperBlockedJobs(input.shopId);
    }
    return outcome.response;
  }

  private async assertMember(shopId: string, userId: string): Promise<void> {
    if (!(await this.shopMembership.isActiveStaff(shopId, userId))) {
      throw new ForbiddenException("You do not have access to this shop's settings.");
    }
  }

  /** A patch is refused unless the actor's role at THIS shop holds the permission
   * for every group it touches (data in ROLE_PERMISSIONS, never role branches). */
  private async assertMayChange(
    shopId: string,
    userId: string,
    keys: readonly SettingKey[],
  ): Promise<void> {
    const role = await this.shopMembership.getEffectiveRole(shopId, userId);
    const held = new Set<string>(role ? (ROLE_PERMISSIONS[role] ?? []) : []);
    const touchesBusiness = keys.some((key) =>
      (BUSINESS_SETTING_KEYS as readonly string[]).includes(key),
    );
    const touchesAutomation = keys.some((key) =>
      (AUTOMATION_SETTING_KEYS as readonly string[]).includes(key),
    );
    if (
      (touchesBusiness && !held.has(Permission.MANAGE_SETTINGS)) ||
      (touchesAutomation && !held.has(Permission.MANAGE_AUTOMATION))
    ) {
      throw new ForbiddenException("Insufficient permission for this resource.");
    }
  }
}
