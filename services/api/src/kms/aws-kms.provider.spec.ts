import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  DecryptCommand,
  EncryptCommand,
  GenerateDataKeyCommand,
  KMSClient,
} from "@aws-sdk/client-kms";
import { mockClient } from "aws-sdk-client-mock";
import { AwsKmsProvider } from "./aws-kms.provider.js";
import { runKeyManagementServiceContract } from "./kms-contract.spec-helper.js";

// No real AWS account is available in this environment (12.7/12.8 wire
// real credentials once staging exists). This mock doesn't just return
// canned bytes -- it does real AES-256-GCM encrypt/decrypt behind the
// mocked KMSClient.send(), so the exact same contract suite (round trip,
// tamper detection) exercises AwsKmsProvider's actual request/response
// mapping logic meaningfully rather than trivially.
const FAKE_KMS_MASTER_KEY = randomBytes(32);

function fakeKmsEncrypt(plaintext: Uint8Array): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", FAKE_KMS_MASTER_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

function fakeKmsDecrypt(blob: Uint8Array): Buffer {
  const buffer = Buffer.from(blob);
  const iv = buffer.subarray(0, 12);
  const authTag = buffer.subarray(12, 28);
  const ciphertext = buffer.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", FAKE_KMS_MASTER_KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

const kmsMock = mockClient(KMSClient);

function createMockedAwsKmsProvider(): AwsKmsProvider {
  kmsMock.reset();
  kmsMock.on(EncryptCommand).callsFake((input) => ({
    CiphertextBlob: fakeKmsEncrypt(input.Plaintext as Uint8Array),
  }));
  kmsMock.on(DecryptCommand).callsFake((input) => ({
    Plaintext: fakeKmsDecrypt(input.CiphertextBlob as Uint8Array),
  }));
  kmsMock.on(GenerateDataKeyCommand).callsFake(() => {
    const plaintext = randomBytes(32);
    return { Plaintext: plaintext, CiphertextBlob: fakeKmsEncrypt(plaintext) };
  });

  return new AwsKmsProvider(new KMSClient({ region: "us-east-1" }), "arn:aws:kms:fake:test-key");
}

runKeyManagementServiceContract("AwsKmsProvider (mocked KMSClient)", createMockedAwsKmsProvider);

describe("AwsKmsProvider", () => {
  it("passes the configured KeyId through to Encrypt/Decrypt/GenerateDataKey", async () => {
    const provider = createMockedAwsKmsProvider();
    const plaintextDek = randomBytes(32);

    const wrapped = await provider.wrap(plaintextDek);
    await provider.unwrap(wrapped);
    await provider.generateDataKey();

    const calls = kmsMock.commandCalls(EncryptCommand);
    expect(calls[0]?.args[0]?.input.KeyId).toBe("arn:aws:kms:fake:test-key");
    const decryptCalls = kmsMock.commandCalls(DecryptCommand);
    expect(decryptCalls[0]?.args[0]?.input.KeyId).toBe("arn:aws:kms:fake:test-key");
    const genCalls = kmsMock.commandCalls(GenerateDataKeyCommand);
    expect(genCalls[0]?.args[0]?.input.KeySpec).toBe("AES_256");
  });
});
