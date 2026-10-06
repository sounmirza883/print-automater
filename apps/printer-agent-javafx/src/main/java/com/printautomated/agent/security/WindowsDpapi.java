package com.printautomated.agent.security;

import com.sun.jna.platform.win32.Crypt32Util;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

public class WindowsDpapi {
    private static final boolean IS_WINDOWS = System.getProperty("os.name", "").toLowerCase().contains("win");

    public static byte[] protect(byte[] plaintext) {
        if (plaintext == null || plaintext.length == 0) return new byte[0];
        if (IS_WINDOWS) {
            try {
                return Crypt32Util.cryptProtectData(plaintext);
            } catch (Throwable t) {
                // Fallback if DPAPI fails
                return fallbackEncode(plaintext);
            }
        }
        return fallbackEncode(plaintext);
    }

    public static byte[] unprotect(byte[] ciphertext) {
        if (ciphertext == null || ciphertext.length == 0) return new byte[0];
        if (IS_WINDOWS) {
            try {
                return Crypt32Util.cryptUnprotectData(ciphertext);
            } catch (Throwable t) {
                // Fallback attempt
                return fallbackDecode(ciphertext);
            }
        }
        return fallbackDecode(ciphertext);
    }

    public static byte[] protectString(String text) {
        if (text == null) return new byte[0];
        return protect(text.getBytes(StandardCharsets.UTF_8));
    }

    public static String unprotectString(byte[] ciphertext) {
        byte[] decrypted = unprotect(ciphertext);
        if (decrypted == null || decrypted.length == 0) return "";
        return new String(decrypted, StandardCharsets.UTF_8);
    }

    private static byte[] fallbackEncode(byte[] data) {
        return Base64.getEncoder().encode(data);
    }

    private static byte[] fallbackDecode(byte[] data) {
        try {
            return Base64.getDecoder().decode(data);
        } catch (IllegalArgumentException e) {
            return data;
        }
    }
}
