import type {
  OperatorWorkloadReport,
  OrdersReport,
  PaperConsumptionReport,
  PrinterUsageReport,
  PrintingVolumeReport,
  ReportGroupBy,
  RevenueReport,
  SupplierPurchasesReport,
} from "@print-automated/types";
import type { HttpClient } from "../http-client.js";

export interface ReportParams {
  from?: string;
  to?: string;
  groupBy?: ReportGroupBy;
  /** 23.10: the money reports' currency (3 letters); default = the one with the most money. */
  currency?: string;
}

/** The report names as they appear in the URL (`/v1/shop/reports/<name>`). */
export type ReportName =
  | "orders"
  | "revenue"
  | "printing-volume"
  | "printers"
  | "operator-workload"
  | "paper-consumption"
  | "supplier-purchases";

/** 23.5 (PRD 72-74). All need `Permission.VIEW_REPORTS` (owner, manager). The JSON
 * form is fetched here; for a CSV download navigate to the same URL with `format=csv`
 * (see `csvPath`), since a download is not a JSON response. */
export class ReportsResource {
  constructor(private readonly http: HttpClient) {}

  private get<T>(name: string, shopId: string, params: ReportParams): Promise<T> {
    return this.http.request<T>(`/v1/shop/reports/${name}`, {
      query: {
        shopId,
        from: params.from,
        to: params.to,
        groupBy: params.groupBy,
        currency: params.currency,
      },
    });
  }

  /** 23.29: the report's rows as a CSV file (fetched as a blob, so the caller names the
   * download; a proxy in front of the API need not pass Content-Disposition through). */
  csv(name: ReportName, shopId: string, params: ReportParams = {}): Promise<Blob> {
    return this.http.requestBlob(`/v1/shop/reports/${name}`, {
      query: {
        shopId,
        format: "csv",
        from: params.from,
        to: params.to,
        groupBy: params.groupBy,
        currency: params.currency,
      },
    });
  }

  csvPath(name: string, shopId: string, params: ReportParams = {}): string {
    const query = new URLSearchParams({ shopId, format: "csv" });
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        query.set(key, value);
      }
    }
    return `/v1/shop/reports/${name}?${query.toString()}`;
  }

  orders(shopId: string, params: ReportParams = {}): Promise<OrdersReport> {
    return this.get("orders", shopId, params);
  }
  revenue(shopId: string, params: ReportParams = {}): Promise<RevenueReport> {
    return this.get("revenue", shopId, params);
  }
  printingVolume(shopId: string, params: ReportParams = {}): Promise<PrintingVolumeReport> {
    return this.get("printing-volume", shopId, params);
  }
  printers(shopId: string, params: ReportParams = {}): Promise<PrinterUsageReport> {
    return this.get("printers", shopId, params);
  }
  operatorWorkload(shopId: string, params: ReportParams = {}): Promise<OperatorWorkloadReport> {
    return this.get("operator-workload", shopId, params);
  }
  paperConsumption(shopId: string, params: ReportParams = {}): Promise<PaperConsumptionReport> {
    return this.get("paper-consumption", shopId, params);
  }
  supplierPurchases(shopId: string, params: ReportParams = {}): Promise<SupplierPurchasesReport> {
    return this.get("supplier-purchases", shopId, params);
  }
}
