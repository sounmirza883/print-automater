import type { HttpClient } from "../http-client.js";
import type { PrinterCapabilities, PrinterResponse } from "../types.js";

export interface RegisterPrinterInput {
  shopId: string;
  name: string;
  capabilities?: PrinterCapabilities;
}

export interface UpdatePrinterInput {
  name?: string;
  enabled?: boolean;
  capabilities?: PrinterCapabilities;
}

export class PrintersResource {
  constructor(private readonly http: HttpClient) {}

  list(shopId: string): Promise<PrinterResponse[]> {
    return this.http.request<PrinterResponse[]>("/v1/shop/printers", { query: { shopId } });
  }

  register(input: RegisterPrinterInput): Promise<PrinterResponse> {
    return this.http.request<PrinterResponse>("/v1/shop/printers", {
      method: "POST",
      body: input,
    });
  }

  update(printerId: string, input: UpdatePrinterInput): Promise<PrinterResponse> {
    return this.http.request<PrinterResponse>(`/v1/shop/printers/${printerId}`, {
      method: "PATCH",
      body: input,
    });
  }

  remove(printerId: string): Promise<void> {
    return this.http.request<void>(`/v1/shop/printers/${printerId}`, { method: "DELETE" });
  }
}
