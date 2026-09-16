import { HttpClient, type HttpClientOptions } from "./http-client.js";
import { AuthResource } from "./resources/auth.resource.js";
import { DocumentsResource } from "./resources/documents.resource.js";
import { ShopOrdersResource } from "./resources/shop-orders.resource.js";
import { PrintersResource } from "./resources/printers.resource.js";
import { ShopStaffResource } from "./resources/shop-staff.resource.js";

export class ApiClient {
  readonly auth: AuthResource;
  readonly documents: DocumentsResource;
  readonly shopOrders: ShopOrdersResource;
  readonly printers: PrintersResource;
  readonly shopStaff: ShopStaffResource;

  constructor(options: HttpClientOptions) {
    const http = new HttpClient(options);
    this.auth = new AuthResource(http);
    this.documents = new DocumentsResource(http);
    this.shopOrders = new ShopOrdersResource(http);
    this.printers = new PrintersResource(http);
    this.shopStaff = new ShopStaffResource(http);
  }
}
