import * as SecureStore from "expo-secure-store";
import { SecureStoreTokenStorage } from "./secure-store-token-storage.js";

// expo-secure-store wraps a native module (iOS Keychain / Android
// Keystore) that has no meaning under plain Node/Jest -- this mocks
// only that native boundary, not this class's own logic, matching how
// this project already treats genuinely environment-bound APIs (e.g.
// nothing here re-implements the Keychain itself, same as no test
// anywhere in this repo re-implements Postgres).
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockedSecureStore = jest.mocked(SecureStore);

describe("SecureStoreTokenStorage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reads the access and refresh tokens under distinct, namespaced keys", async () => {
    mockedSecureStore.getItemAsync.mockResolvedValueOnce("access-1");
    mockedSecureStore.getItemAsync.mockResolvedValueOnce("refresh-1");
    const storage = new SecureStoreTokenStorage();

    await expect(storage.getAccessToken()).resolves.toBe("access-1");
    await expect(storage.getRefreshToken()).resolves.toBe("refresh-1");

    const keysUsed = mockedSecureStore.getItemAsync.mock.calls.map((call) => call[0]);
    expect(new Set(keysUsed).size).toBe(2);
  });

  it("writes both tokens on setTokens", async () => {
    const storage = new SecureStoreTokenStorage();
    await storage.setTokens({ accessToken: "access-2", refreshToken: "refresh-2" });

    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(expect.any(String), "access-2");
    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(expect.any(String), "refresh-2");
  });

  it("deletes both tokens on clearTokens", async () => {
    const storage = new SecureStoreTokenStorage();
    await storage.clearTokens();

    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledTimes(2);
  });
});
