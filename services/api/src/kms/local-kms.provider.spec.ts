import { LocalKmsProvider } from "./local-kms.provider.js";
import { runKeyManagementServiceContract } from "./kms-contract.spec-helper.js";

runKeyManagementServiceContract(
  "LocalKmsProvider",
  () => new LocalKmsProvider("a-dev-master-key-that-is-at-least-32-chars-long"),
);

describe("LocalKmsProvider", () => {
  it("two providers built from different master keys cannot unwrap each other's wrapped DEK", async () => {
    const providerA = new LocalKmsProvider("master-key-for-provider-a-32-chars-min");
    const providerB = new LocalKmsProvider("master-key-for-provider-b-32-chars-min");

    const { plaintextDek, wrappedDek } = await providerA.generateDataKey();

    await expect(providerB.unwrap(wrappedDek)).rejects.toThrow();
    // Sanity: providerA itself can still recover it.
    await expect(providerA.unwrap(wrappedDek)).resolves.toEqual(plaintextDek);
  });
});
