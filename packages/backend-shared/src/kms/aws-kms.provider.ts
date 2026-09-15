import { Injectable } from "@nestjs/common";
import {
  DecryptCommand,
  EncryptCommand,
  GenerateDataKeyCommand,
  KMSClient,
} from "@aws-sdk/client-kms";
import type { GeneratedDataKey, KeyManagementService } from "./kms.interface.js";

/** §62 prod path: real AWS KMS. The DEK itself never touches disk or
 * logs in plaintext outside this provider -- Encrypt/Decrypt/
 * GenerateDataKey happen entirely within AWS; only the CiphertextBlob
 * ever leaves. */
@Injectable()
export class AwsKmsProvider implements KeyManagementService {
  constructor(
    private readonly client: KMSClient,
    private readonly keyId: string,
  ) {}

  async generateDataKey(): Promise<GeneratedDataKey> {
    const response = await this.client.send(
      new GenerateDataKeyCommand({ KeyId: this.keyId, KeySpec: "AES_256" }),
    );
    if (!response.Plaintext || !response.CiphertextBlob) {
      throw new Error("AWS KMS GenerateDataKey returned no key material.");
    }
    return {
      plaintextDek: Buffer.from(response.Plaintext),
      wrappedDek: Buffer.from(response.CiphertextBlob),
    };
  }

  async wrap(plaintextDek: Buffer): Promise<Buffer> {
    const response = await this.client.send(
      new EncryptCommand({ KeyId: this.keyId, Plaintext: plaintextDek }),
    );
    if (!response.CiphertextBlob) {
      throw new Error("AWS KMS Encrypt returned no ciphertext.");
    }
    return Buffer.from(response.CiphertextBlob);
  }

  async unwrap(wrappedDek: Buffer): Promise<Buffer> {
    const response = await this.client.send(
      new DecryptCommand({ KeyId: this.keyId, CiphertextBlob: wrappedDek }),
    );
    if (!response.Plaintext) {
      throw new Error("AWS KMS Decrypt returned no plaintext.");
    }
    return Buffer.from(response.Plaintext);
  }
}
