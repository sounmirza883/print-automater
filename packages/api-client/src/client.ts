import { HttpClient, type HttpClientOptions } from "./http-client.js";
import { AuthResource } from "./resources/auth.resource.js";
import { DocumentsResource } from "./resources/documents.resource.js";
import { ShopOrdersResource } from "./resources/shop-orders.resource.js";
import { PrintersResource } from "./resources/printers.resource.js";
import { ShopStaffResource } from "./resources/shop-staff.resource.js";
import { DashboardResource } from "./resources/dashboard.resource.js";
import { PrintJobsResource } from "./resources/print-jobs.resource.js";
import {
  InventoryResource,
  SuppliersResource,
  PurchaseOrdersResource,
} from "./resources/inventory.resource.js";
import {
  ProductsResource,
  PricingRulesResource,
  CustomersResource,
} from "./resources/catalog.resource.js";
import { SettingsResource, PrinterRulesResource } from "./resources/settings.resource.js";
import { ReportsResource } from "./resources/reports.resource.js";
import { NotificationsResource } from "./resources/notifications.resource.js";

export class ApiClient {
  readonly auth: AuthResource;
  readonly documents: DocumentsResource;
  readonly shopOrders: ShopOrdersResource;
  readonly printers: PrintersResource;
  readonly shopStaff: ShopStaffResource;
  readonly dashboard: DashboardResource;
  readonly printJobs: PrintJobsResource;
  readonly inventory: InventoryResource;
  readonly suppliers: SuppliersResource;
  readonly purchaseOrders: PurchaseOrdersResource;
  readonly products: ProductsResource;
  readonly pricingRules: PricingRulesResource;
  readonly customers: CustomersResource;
  readonly settings: SettingsResource;
  readonly printerRules: PrinterRulesResource;
  readonly reports: ReportsResource;
  readonly notifications: NotificationsResource;

  constructor(options: HttpClientOptions) {
    const http = new HttpClient(options);
    this.auth = new AuthResource(http);
    this.documents = new DocumentsResource(http);
    this.shopOrders = new ShopOrdersResource(http);
    this.printers = new PrintersResource(http);
    this.shopStaff = new ShopStaffResource(http);
    this.dashboard = new DashboardResource(http);
    this.printJobs = new PrintJobsResource(http);
    this.inventory = new InventoryResource(http);
    this.suppliers = new SuppliersResource(http);
    this.purchaseOrders = new PurchaseOrdersResource(http);
    this.products = new ProductsResource(http);
    this.pricingRules = new PricingRulesResource(http);
    this.customers = new CustomersResource(http);
    this.settings = new SettingsResource(http);
    this.printerRules = new PrinterRulesResource(http);
    this.reports = new ReportsResource(http);
    this.notifications = new NotificationsResource(http);
  }
}
