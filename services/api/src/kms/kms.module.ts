import { Global, Module } from "@nestjs/common";
import { KMSClient } from "@aws-sdk/client-kms";
import type { ApiEnv } from "@print-automated/config";
import { API_ENV } from "../config/config.module.js";
import { KEY_MANAGEMENT_SERVICE, type KeyManagementService } from "./kms.interface.js";
import { LocalKmsProvider } from "./local-kms.provider.js";
import { AwsKmsProvider } from "./aws-kms.provider.js";

@Global()
@Module({
  providers: [
    {
      provide: KEY_MANAGEMENT_SERVICE,
      inject: [API_ENV],
      useFactory: (env: ApiEnv): KeyManagementService => {
        if (env.KMS_PROVIDER === "aws") {
          if (!env.KMS_AWS_KEY_ID) {
            // Unreachable in practice: apiEnvSchema's checkStorageEnv
            // already requires KMS_AWS_KEY_ID when KMS_PROVIDER=aws.
            throw new Error("KMS_AWS_KEY_ID is required when KMS_PROVIDER=aws.");
          }
          return new AwsKmsProvider(new KMSClient({ region: env.S3_REGION }), env.KMS_AWS_KEY_ID);
        }
        if (!env.KMS_LOCAL_MASTER_KEY) {
          throw new Error("KMS_LOCAL_MASTER_KEY is required when KMS_PROVIDER=local.");
        }
        return new LocalKmsProvider(env.KMS_LOCAL_MASTER_KEY);
      },
    },
  ],
  exports: [KEY_MANAGEMENT_SERVICE],
})
export class KmsModule {}
