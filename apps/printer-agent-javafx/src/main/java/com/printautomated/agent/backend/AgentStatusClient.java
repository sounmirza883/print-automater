package com.printautomated.agent.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.printautomated.agent.models.AgentStatus;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

public class AgentStatusClient {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String DEFAULT_LOOPBACK_URL = "http://127.0.0.1:7171";

    private final String loopbackUrl;
    private final HttpClient httpClient;

    public AgentStatusClient() {
        this(DEFAULT_LOOPBACK_URL);
    }

    public AgentStatusClient(String loopbackUrl) {
        this.loopbackUrl = loopbackUrl.endsWith("/") ? loopbackUrl.substring(0, loopbackUrl.length() - 1) : loopbackUrl;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(2))
                .build();
    }

    public AgentStatus fetchStatus() {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(loopbackUrl + "/status"))
                    .header("Accept", "application/json")
                    .timeout(Duration.ofSeconds(3))
                    .GET()
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 200) {
                return MAPPER.readValue(response.body(), AgentStatus.class);
            }
        } catch (Exception ignored) {
            // Agent service loopback not responding or agent running standalone
        }

        AgentStatus fallback = new AgentStatus();
        fallback.setPaired(false);
        fallback.setLastError("Connecting to local agent service...");
        return fallback;
    }

    public void pair(String pairingCode) throws IOException, InterruptedException {
        Map<String, String> body = new HashMap<>();
        body.put("code", pairingCode.trim().toLowerCase());
        String json = MAPPER.writeValueAsString(body);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(loopbackUrl + "/pair"))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .timeout(Duration.ofSeconds(10))
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200 && response.statusCode() != 204) {
            String msg = "Pairing failed (HTTP " + response.statusCode() + ")";
            try {
                JsonNode node = MAPPER.readTree(response.body());
                if (node.has("message")) msg = node.get("message").asText();
                else if (node.has("error")) msg = node.get("error").asText();
            } catch (Exception ignored) {}
            throw new IOException(msg);
        }
    }
}
