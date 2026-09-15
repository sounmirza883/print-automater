import * as SecureStore from "expo-secure-store";
import type { AuthTokens, TokenStorage } from "@print-automated/api-client";

const ACCESS_TOKEN_KEY = "print_automated.access_token";
const REFRESH_TOKEN_KEY = "print_automated.refresh_token";

/** The real `TokenStorage` (packages/api-client, 3.1) implementation
 * for this app -- `expo-secure-store` wraps iOS Keychain / Android
 * Keystore, so the token pair never sits in plain storage on the
 * device. This is what makes "persists the session across restart"
 * (§3.4's Done-when) actually true rather than merely in-memory. */
export class SecureStoreTokenStorage implements TokenStorage {
  async getAccessToken(): Promise<string | null> {
    return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  }

  async getRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  }

  async setTokens(tokens: AuthTokens): Promise<void> {
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
    ]);
  }

  async clearTokens(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    ]);
  }
}
