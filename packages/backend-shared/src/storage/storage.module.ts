import { DynamicModule, Global, Inject, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import { S3Client } from "@aws-sdk/client-s3";
import { StorageService } from "./storage.service.js";
import { S3_CLIENT, STORAGE_BUCKET } from "./storage.tokens.js";

export interface StorageModuleOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/** Bucket-level server-side encryption (§61's "server-side encryption
 * enabled on the bucket", §63 layer 2) is deliberately NOT configured
 * here. On AWS this is one Terraform attribute (12.7) with no extra
 * infrastructure. On MinIO, SSE requires an external KMS backend
 * (Vault or MinIO KES) that this dev stack (0.4) doesn't run -- adding
 * one just for local dev isn't worth the complexity, especially since
 * the real confidentiality boundary is already the application-level
 * envelope encryption (2.2/2.3, AES-256-GCM + KMS-wrapped DEK) applied
 * to every object under documents/{id} before it ever reaches S3/MinIO.
 * Bucket-level SSE would only add defense-in-depth for the quarantine
 * prefix's brief plaintext window, which 2.7 deletes unconditionally
 * on every path anyway. */

/** Not exported: destroys the S3Client's http handler on app shutdown/
 * app.close(), same reasoning as RedisLifecycle. */
@Injectable()
class S3ClientLifecycle implements OnModuleDestroy {
  constructor(@Inject(S3_CLIENT) private readonly client: S3Client) {}

  onModuleDestroy(): void {
    this.client.destroy();
  }
}

/** forRoot(), same reasoning as RedisModule -- the S3 config lives in
 * each app's own differently-shaped env object, so this module takes
 * the values directly rather than depending on an app-specific token. */
@Global()
@Module({})
export class StorageModule {
  static forRoot(options: StorageModuleOptions): DynamicModule {
    return {
      module: StorageModule,
      providers: [
        {
          provide: S3_CLIENT,
          useFactory: () =>
            new S3Client({
              endpoint: options.endpoint,
              region: options.region,
              forcePathStyle: options.forcePathStyle,
              credentials: {
                accessKeyId: options.accessKeyId,
                secretAccessKey: options.secretAccessKey,
              },
            }),
        },
        { provide: STORAGE_BUCKET, useValue: options.bucket },
        S3ClientLifecycle,
        StorageService,
      ],
      exports: [S3_CLIENT, STORAGE_BUCKET, StorageService],
    };
  }
}
