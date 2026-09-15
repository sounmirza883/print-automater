import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { apiEnvSchema, loadEnv } from "@print-automated/config";
import { StorageService } from "./storage.service.js";

describe("StorageService (integration, real MinIO)", () => {
  const env = loadEnv(apiEnvSchema, process.env);
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  });
  const service = new StorageService(s3, env);

  afterAll(() => {
    s3.destroy();
  });

  it("builds the quarantine/{id} and documents/{id} key layout (§61)", () => {
    const id = randomUUID();
    expect(service.quarantineKey(id)).toBe(`quarantine/${id}`);
    expect(service.documentKey(id)).toBe(`documents/${id}`);
  });

  it("round-trips an object through MinIO via a presigned PUT then a presigned GET URL", async () => {
    const key = service.quarantineKey(randomUUID());
    const body = Buffer.from(`hello from storage.service.spec.ts ${randomUUID()}`);

    // A real, unauthenticated HTTP client -- not the AWS SDK -- using
    // exactly the URLs a browser/mobile client would be handed. Proves
    // MinIO actually accepts the signed request, not just that the SDK
    // can construct a well-formed URL.
    const putUrl = await service.createPresignedPutUrl(key, "text/plain");
    const putResponse = await fetch(putUrl, {
      method: "PUT",
      body,
      headers: { "Content-Type": "text/plain" },
    });
    expect(putResponse.ok).toBe(true);

    const getUrl = await service.createPresignedGetUrl(key);
    const getResponse = await fetch(getUrl);
    expect(getResponse.ok).toBe(true);
    const downloaded = Buffer.from(await getResponse.arrayBuffer());
    expect(downloaded.equals(body)).toBe(true);

    await service.deleteObject(key);
    await expect(service.objectExists(key)).resolves.toBe(false);
  });

  it("round-trips an object through direct putObjectBuffer/getObjectBuffer (2.7's worker path)", async () => {
    const key = service.documentKey(randomUUID());
    const body = Buffer.from(`direct buffer round trip ${randomUUID()}`);

    await expect(service.objectExists(key)).resolves.toBe(false);

    await service.putObjectBuffer(key, body, "application/octet-stream");
    await expect(service.objectExists(key)).resolves.toBe(true);

    const downloaded = await service.getObjectBuffer(key);
    expect(downloaded.equals(body)).toBe(true);

    await service.deleteObject(key);
    await expect(service.objectExists(key)).resolves.toBe(false);
  });
});
