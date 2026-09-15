import { Global, Inject, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import { S3Client } from "@aws-sdk/client-s3";
import type { ApiEnv } from "@print-automated/config";
import { API_ENV } from "../config/config.module.js";

export const S3_CLIENT = Symbol("S3_CLIENT");

/** Not exported: destroys the S3Client's http handler on app shutdown/
 * app.close(), same reasoning as RedisLifecycle. */
@Injectable()
class S3ClientLifecycle implements OnModuleDestroy {
  constructor(@Inject(S3_CLIENT) private readonly client: S3Client) {}

  onModuleDestroy(): void {
    this.client.destroy();
  }
}

/** Global: just the connection, for now. This is a minimal seed for
 * Phase 2.1's real storage module (presigned PUT/GET, the
 * quarantine/{uuid} vs documents/{uuid} key layout) -- 1.8 only needs a
 * client to prove S3 is reachable from /health/ready. */
@Global()
@Module({
  providers: [
    {
      provide: S3_CLIENT,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) =>
        new S3Client({
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
          credentials: {
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          },
        }),
    },
    S3ClientLifecycle,
  ],
  exports: [S3_CLIENT],
})
export class StorageModule {}
