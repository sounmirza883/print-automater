import type { HttpClient } from "../http-client.js";

export interface OperatingHours {
  timezone: string;
  weekly: Partial<
    Record<
      "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun",
      Array<{ open: string; close: string }>
    >
  >;
}

export interface ShopSettings {
  shopId: string;
  version: number;
  updatedAt: string;
  currency: string;
  taxRateBasisPoints: number | null;
  operatingHours: OperatingHours | null;
  notificationSettings: { emailEnabled: boolean; appEnabled: boolean };
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

export type ShopSettingsPatch = Partial<
  Omit<ShopSettings, "shopId" | "version" | "updatedAt" | "notificationSettings" | "operatingHours">
> & {
  operatingHours?: OperatingHours | null;
  notificationSettings?: Partial<{ emailEnabled: boolean; appEnabled: boolean }>;
};

export interface PrinterRule {
  id: string;
  shopId: string;
  position: number;
  name: string;
  enabled: boolean;
  action: "PREFER" | "AVOID";
  printerIds: string[];
  conditions: {
    paperSize?: string;
    color?: string;
    sides?: string;
    paperType?: string;
    minPages?: number;
    maxPages?: number;
  };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PrinterRuleInput {
  name: string;
  action: "PREFER" | "AVOID";
  printerIds: string[];
  conditions: PrinterRule["conditions"];
  enabled: boolean;
}

/** VIEW_SETTINGS reads; each key of a PUT needs the permission of its group
 * (business details MANAGE_SETTINGS, automation toggles MANAGE_AUTOMATION). */
export class SettingsResource {
  constructor(private readonly http: HttpClient) {}

  get(shopId: string): Promise<ShopSettings> {
    return this.http.request("/v1/shop/settings", { query: { shopId } });
  }

  /** `expectedVersion` makes it optimistic: 409 SETTINGS_VERSION_CONFLICT if another save landed first. */
  update(shopId: string, expectedVersion: number, patch: ShopSettingsPatch): Promise<ShopSettings> {
    return this.http.request("/v1/shop/settings", {
      method: "PUT",
      body: { shopId, expectedVersion, ...patch },
    });
  }
}

/** VIEW_SETTINGS reads; changes need MANAGE_AUTOMATION. Rules apply in `position` order. */
export class PrinterRulesResource {
  constructor(private readonly http: HttpClient) {}

  list(shopId: string): Promise<PrinterRule[]> {
    return this.http.request("/v1/shop/printer-rules", { query: { shopId } });
  }

  create(shopId: string, input: PrinterRuleInput): Promise<PrinterRule> {
    return this.http.request("/v1/shop/printer-rules", {
      method: "POST",
      body: { shopId, ...input },
    });
  }

  update(
    id: string,
    expectedVersion: number,
    input: Partial<PrinterRuleInput>,
  ): Promise<PrinterRule> {
    return this.http.request(`/v1/shop/printer-rules/${id}`, {
      method: "PATCH",
      body: { expectedVersion, ...input },
    });
  }

  /** `ruleIds` must be EVERY rule, in the new order (409 RULE_ORDER_MISMATCH otherwise). */
  reorder(shopId: string, ruleIds: string[]): Promise<PrinterRule[]> {
    return this.http.request("/v1/shop/printer-rules/order", {
      method: "PUT",
      body: { shopId, ruleIds },
    });
  }

  remove(id: string): Promise<unknown> {
    return this.http.request(`/v1/shop/printer-rules/${id}`, { method: "DELETE" });
  }
}
