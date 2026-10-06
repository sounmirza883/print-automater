package com.printautomated.agent.backend;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public class ApiClient {
    private final String apiBaseUrl;
    private final Session session;
    private final AuthClient authClient;
    private final HttpClient httpClient;

    public ApiClient(String apiBaseUrl, Session session, AuthClient authClient) {
        this.apiBaseUrl = apiBaseUrl.endsWith("/") ? apiBaseUrl.substring(0, apiBaseUrl.length() - 1) : apiBaseUrl;
        this.session = session;
        this.authClient = authClient;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
    }

    public HttpResponse<String> get(String path) throws IOException, InterruptedException {
        return executeWithAuth("GET", path, null);
    }

    public HttpResponse<String> post(String path, String jsonBody) throws IOException, InterruptedException {
        return executeWithAuth("POST", path, jsonBody);
    }

    public HttpResponse<String> patch(String path, String jsonBody) throws IOException, InterruptedException {
        return executeWithAuth("PATCH", path, jsonBody);
    }

    private HttpResponse<String> executeWithAuth(String method, String path, String jsonBody)
            throws IOException, InterruptedException {
        String token = session.getCurrent() != null ? session.getCurrent().getAccessToken() : "";
        HttpResponse<String> response = sendRequest(method, path, jsonBody, token);

        if (response.statusCode() == 401 && session.getCurrent() != null) {
            String refreshToken = session.getCurrent().getRefreshToken();
            if (refreshToken != null && !refreshToken.isBlank()) {
                try {
                    var refreshed = authClient.refresh(refreshToken, token);
                    session.set(refreshed);
                    String newToken = refreshed.getAccessToken();
                    response = sendRequest(method, path, jsonBody, newToken);
                } catch (Exception e) {
                    session.clear();
                    throw new IOException("Session expired, please sign in again: " + e.getMessage(), e);
                }
            }
        }

        return response;
    }

    private HttpResponse<String> sendRequest(String method, String path, String jsonBody, String token)
            throws IOException, InterruptedException {
        String fullUrl = path.startsWith("http") ? path : apiBaseUrl + (path.startsWith("/") ? path : "/" + path);
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create(fullUrl))
                .header("Accept", "application/json")
                .timeout(Duration.ofSeconds(20));

        if (token != null && !token.isBlank()) {
            builder.header("Authorization", "Bearer " + token);
        }

        if ("POST".equalsIgnoreCase(method)) {
            builder.header("Content-Type", "application/json");
            builder.POST(HttpRequest.BodyPublishers.ofString(jsonBody != null ? jsonBody : "{}"));
        } else if ("PATCH".equalsIgnoreCase(method)) {
            builder.header("Content-Type", "application/json");
            builder.method("PATCH", HttpRequest.BodyPublishers.ofString(jsonBody != null ? jsonBody : "{}"));
        } else {
            builder.GET();
        }

        return httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    public String getApiBaseUrl() { return apiBaseUrl; }
    public Session getSession() { return session; }
}
