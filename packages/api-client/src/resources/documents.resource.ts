import type { CreateDocumentInput } from "@print-automated/validation";
import type { HttpClient } from "../http-client.js";
import type { CreateDocumentResult, DocumentStatusView } from "../types.js";

export class DocumentsResource {
  constructor(private readonly http: HttpClient) {}

  create(input: CreateDocumentInput): Promise<CreateDocumentResult> {
    return this.http.request<CreateDocumentResult>("/v1/documents", {
      method: "POST",
      body: input,
    });
  }

  confirmUpload(documentId: string): Promise<DocumentStatusView> {
    return this.http.request<DocumentStatusView>(`/v1/documents/${documentId}/upload`, {
      method: "POST",
    });
  }

  getStatus(documentId: string): Promise<DocumentStatusView> {
    return this.http.request<DocumentStatusView>(`/v1/documents/${documentId}`);
  }

  remove(documentId: string): Promise<void> {
    return this.http.request<void>(`/v1/documents/${documentId}`, { method: "DELETE" });
  }

  /** §65: streams the decrypted bytes through this one authenticated
   * call -- never a link a caller could reuse or share. Returns a `Blob`
   * so web (`URL.createObjectURL`) and mobile (write to a local file)
   * can each consume it in whatever way fits that platform. */
  download(documentId: string): Promise<Blob> {
    return this.http.requestBlob(`/v1/documents/${documentId}/download`);
  }
}
