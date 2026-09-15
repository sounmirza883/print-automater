import { Inject, Injectable } from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3_CLIENT, STORAGE_BUCKET } from "./storage.tokens.js";

const PRESIGNED_PUT_TTL_SECONDS = 15 * 60;
const PRESIGNED_GET_TTL_SECONDS = 5 * 60;

/** Key layout (§61): a document's whole lifecycle lives at two possible
 * keys, never anywhere else. `quarantine/{id}` holds the untrusted
 * upload while 2.7's worker validates/scans/encrypts it; `documents/{id}`
 * holds the final, application-encrypted (2.2/2.3) object. Nothing in
 * this codebase constructs either key string except through here. */
@Injectable()
export class StorageService {
  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(STORAGE_BUCKET) private readonly bucket: string,
  ) {}

  quarantineKey(documentId: string): string {
    return `quarantine/${documentId}`;
  }

  documentKey(documentId: string): string {
    return `documents/${documentId}`;
  }

  /** Short-lived, single-object upload URL (§65) -- the client PUTs
   * directly to S3/MinIO, the raw bytes never pass through this API. */
  createPresignedPutUrl(key: string, contentType = "application/pdf"): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.s3, command, { expiresIn: PRESIGNED_PUT_TTL_SECONDS });
  }

  /** Short-lived read URL. Not used for customer/shop/agent document
   * access in the running app -- those go through the authenticated,
   * audited streaming endpoints from 2.8 (§65 prohibits permanent
   * public URLs). This exists for the narrower case of handing a
   * short-lived link to a trusted internal caller. */
  createPresignedGetUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: PRESIGNED_GET_TTL_SECONDS });
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const result = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) {
      throw new Error(`Object body was empty for key "${key}"`);
    }
    return Buffer.from(bytes);
  }

  async putObjectBuffer(
    key: string,
    body: Buffer,
    contentType = "application/octet-stream",
  ): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === "NotFound") {
        return false;
      }
      throw error;
    }
  }
}
