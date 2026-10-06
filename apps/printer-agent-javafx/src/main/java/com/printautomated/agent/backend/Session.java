package com.printautomated.agent.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.printautomated.agent.models.StaffSession;
import com.printautomated.agent.security.WindowsDpapi;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Base64;

public class Session {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final Path sessionFile;
    private StaffSession currentSession;

    public Session(Path sessionFile) {
        this.sessionFile = sessionFile;
    }

    public synchronized StaffSession getCurrent() {
        return currentSession;
    }

    public synchronized void set(StaffSession session) {
        this.currentSession = session;
        persist();
    }

    public synchronized void clear() {
        this.currentSession = null;
        if (sessionFile != null) {
            try {
                Files.deleteIfExists(sessionFile);
            } catch (IOException ignored) {}
        }
    }

    public synchronized boolean isExpired() {
        if (currentSession == null || currentSession.getAccessToken() == null || currentSession.getAccessToken().isBlank()) {
            return true;
        }
        Instant expiry = parseJwtExpiry(currentSession.getAccessToken());
        if (expiry == null) {
            return false;
        }
        // Buffer of 30 seconds
        return Instant.now().plusSeconds(30).isAfter(expiry);
    }

    public synchronized boolean hasValidSession() {
        return currentSession != null && !isExpired();
    }

    public synchronized boolean loadPersisted() {
        if (sessionFile == null || !Files.isRegularFile(sessionFile)) {
            return false;
        }
        try {
            byte[] ciphertext = Files.readAllBytes(sessionFile);
            String json = WindowsDpapi.unprotectString(ciphertext);
            if (json == null || json.isBlank()) return false;

            StaffSession loaded = MAPPER.readValue(json, StaffSession.class);
            if (loaded != null && loaded.getRefreshToken() != null && !loaded.getRefreshToken().isBlank()) {
                this.currentSession = loaded;
                return true;
            }
        } catch (Exception e) {
            clear();
        }
        return false;
    }

    private void persist() {
        if (sessionFile == null) return;
        try {
            if (currentSession == null) {
                Files.deleteIfExists(sessionFile);
                return;
            }
            String json = MAPPER.writeValueAsString(currentSession);
            byte[] protectedBytes = WindowsDpapi.protectString(json);
            if (sessionFile.getParent() != null) {
                Files.createDirectories(sessionFile.getParent());
            }
            Files.write(sessionFile, protectedBytes);
        } catch (IOException ignored) {}
    }

    public static Instant parseJwtExpiry(String jwt) {
        if (jwt == null) return null;
        String[] parts = jwt.split("\\.");
        if (parts.length < 2) return null;
        try {
            byte[] payloadBytes = Base64.getUrlDecoder().decode(parts[1]);
            String payloadJson = new String(payloadBytes, StandardCharsets.UTF_8);
            JsonNode node = MAPPER.readTree(payloadJson);
            if (node.has("exp")) {
                long expSeconds = node.get("exp").asLong();
                return Instant.ofEpochSecond(expSeconds);
            }
        } catch (Exception ignored) {}
        return null;
    }
}
