import { DynamicModule, Global, Module } from "@nestjs/common";
import { KMSClient } from "@aws-sdk/client-kms";
import { KEY_MANAGEMENT_SERVICE, type KeyManagementService } from "./kms.interface.js";
import { LocalKmsProvider } from "./local-kms.provider.js";
import { AwsKmsProvider } from "./aws-kms.provider.js";

export type KmsModuleOptions =
  | { provider: "local"; localMasterKey: string }
  | { provider: "aws"; awsKeyId: string; awsRegion: string };

/** forRoot(), same reasoning as RedisModule/StorageModule -- KMS config
 * lives in each app's own env object, so the resolved options are
 * passed in directly rather than this module depending on an
 * app-specific env token. Each caller is responsible for its own
 * "KMS_AWS_KEY_ID required when KMS_PROVIDER=aws"-style validation
 * (packages/config's checkStorageEnv already does this for both
 * ApiEnv and WorkerEnv before forRoot() is ever called). */
@Global()
@Module({})
export class KmsModule {
  static forRoot(options: KmsModuleOptions): DynamicModule {
    return {
      module: KmsModule,
      providers: [
        {
          provide: KEY_MANAGEMENT_SERVICE,
          useFactory: (): KeyManagementService =>
            options.provider === "aws"
              ? new AwsKmsProvider(new KMSClient({ region: options.awsRegion }), options.awsKeyId)
              : new LocalKmsProvider(options.localMasterKey),
        },
      ],
      exports: [KEY_MANAGEMENT_SERVICE],
    };
  }
}
