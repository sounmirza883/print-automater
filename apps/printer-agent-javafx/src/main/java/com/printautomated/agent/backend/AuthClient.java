package com.printautomated.agent.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.printautomated.agent.models.StaffSession;
import com.printautomated.agent.models.StaffUser;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

public class AuthClient {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final String apiBaseUrl;
    private final HttpClient httpClient;

    public AuthClient(String apiBaseUrl) {
        this.apiBaseUrl = apiBaseUrl.endsWith("/") ? apiBaseUrl.substring(0, apiBaseUrl.length() - 1) : apiBaseUrl;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
    }

    public StaffSession login(String email, String password) throws IOException, InterruptedException {
        Map<String, String> body = new HashMap<>();
        body.put("email", email);
        body.put("password", password);
        String jsonBody = MAPPER.writeValueAsString(body);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(apiBaseUrl + "/v1/auth/login"))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .timeout(Duration.ofSeconds(15))
                .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200 && response.statusCode() != 201) {
            throw parseError(response);
        }

        return parseSessionResponse(response.body());
    }

    public StaffSession refresh(String refreshToken, String oldAccessToken) throws IOException, InterruptedException {
        Map<String, String> body = new HashMap<>();
        body.put("refreshToken", refreshToken);
        String jsonBody = MAPPER.writeValueAsString(body);

        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create(apiBaseUrl + "/v1/auth/refresh"))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .timeout(Duration.ofSeconds(15))
                .POST(HttpRequest.BodyPublishers.ofString(jsonBody));

        if (oldAccessToken != null && !oldAccessToken.isBlank()) {
            builder.header("Authorization", "Bearer " + oldAccessToken);
        }

        HttpResponse<String> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200 && response.statusCode() != 201) {
            throw parseError(response);
        }

        return parseSessionResponse(response.body());
    }

    public void logout(String refreshToken, String accessToken) {
        try {
            Map<String, String> body = new HashMap<>();
            body.put("refreshToken", refreshToken);
            String jsonBody = MAPPER.writeValueAsString(body);

            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(apiBaseUrl + "/v1/auth/logout"))
                    .header("Content-Type", "application/json")
                    .timeout(Duration.ofSeconds(5))
                    .POST(HttpRequest.BodyPublishers.ofString(jsonBody));

            if (accessToken != null && !accessToken.isBlank()) {
                builder.header("Authorization", "Bearer " + accessToken);
            }

            httpClient.send(builder.build(), HttpResponse.BodyHandlers.discarding());
        } catch (Exception ignored) {}
    }

    private StaffSession parseSessionResponse(String json) throws IOException {
        JsonNode root = MAPPER.readTree(json);
        JsonNode data = root.has("data") ? root.get("data") : root;

        String accessToken = "";
        String refreshToken = "";

        if (data.has("tokens")) {
            JsonNode tokens = data.get("tokens");
            accessToken = tokens.path("accessToken").asText("");
            refreshToken = tokens.path("refreshToken").asText("");
        } else {
            accessToken = data.path("accessToken").asText("");
            refreshToken = data.path("refreshToken").asText("");
        }

        StaffUser user = new StaffUser();
        JsonNode userNode = data.has("user") ? data.get("user") : null;
        if (userNode != null) {
            user.setId(userNode.path("id").asText(""));
            user.setEmail(userNode.path("email").asText(""));
            user.setFullName(userNode.path("fullName").asText(userNode.path("name").asText("")));
            user.setRole(userNode.path("role").asText(""));
        }

        return new StaffSession(accessToken, refreshToken, user);
    }

    private RuntimeException parseError(HttpResponse<String> response) {
        String msg = "Request failed with HTTP " + response.statusCode();
        try {
            JsonNode node = MAPPER.readTree(response.body());
            if (node.has("message")) {
                msg = node.get("message").asText();
            } else if (node.has("error")) {
                msg = node.get("error").asText();
            }
        } catch (Exception ignored) {}
        return new RuntimeException(msg);
    }
}
