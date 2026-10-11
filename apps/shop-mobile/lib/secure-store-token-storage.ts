import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { AuthTokens, TokenStorage } from "@print-automated/api-client";

const ACCESS_TOKEN_KEY = "print_automated.access_token";
const REFRESH_TOKEN_KEY = "print_automated.refresh_token";

// expo-secure-store has no web implementation at all -- its native
// module resolves to a stub with none of these methods on web, which
// is what throws "getValueWithKeyAsync is not a function" rather than
// a clean unsupported-platform error. Real shop deployments are the
// native app (§3.4, a device in the shop), so `web` here only ever
// runs during Expo's own web-preview dev workflow -- localStorage is
// an acceptable fallback for that, not a production security choice.
const isWeb = Platform.OS === "web";

/** The real `TokenStorage` (packages/api-client, 3.1) implementation
 * for this app -- `expo-secure-store` wraps iOS Keychain / Android
 * Keystore, so the token pair never sits in plain storage on the
 * device. This is what makes "persists the session across restart"
 * (§3.4's Done-when) actually true rather than merely in-memory. */
export class SecureStoreTokenStorage implements TokenStorage {
  async getAccessToken(): Promise<string | null> {
    return isWeb
      ? localStorage.getItem(ACCESS_TOKEN_KEY)
      : SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  }

  async getRefreshToken(): Promise<string | null> {
    return isWeb
      ? localStorage.getItem(REFRESH_TOKEN_KEY)
      : SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  }

  async setTokens(tokens: AuthTokens): Promise<void> {
    if (isWeb) {
      localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
      return;
    }
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
    ]);
  }

  async clearTokens(): Promise<void> {
    if (isWeb) {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      return;
    }
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    ]);
  }
}
