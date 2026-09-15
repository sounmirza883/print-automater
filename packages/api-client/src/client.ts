import { HttpClient, type HttpClientOptions } from "./http-client.js";
import { AuthResource } from "./resources/auth.resource.js";
import { DocumentsResource } from "./resources/documents.resource.js";

export class ApiClient {
  readonly auth: AuthResource;
  readonly documents: DocumentsResource;

  constructor(options: HttpClientOptions) {
    const http = new HttpClient(options);
    this.auth = new AuthResource(http);
    this.documents = new DocumentsResource(http);
  }
}
