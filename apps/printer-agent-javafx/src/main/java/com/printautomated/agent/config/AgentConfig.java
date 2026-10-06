package com.printautomated.agent.config;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

@JsonIgnoreProperties(ignoreUnknown = true)
public class AgentConfig {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @JsonProperty("apiBaseUrl")
    private String apiBaseUrl = "https://api.printautomated.com";

    @JsonProperty("ledgerRetentionDays")
    private int ledgerRetentionDays = 30;

    @JsonProperty("printToFileDir")
    private String printToFileDir = "";

    public AgentConfig() {}

    public AgentConfig(String apiBaseUrl, int ledgerRetentionDays, String printToFileDir) {
        this.apiBaseUrl = apiBaseUrl;
        this.ledgerRetentionDays = ledgerRetentionDays;
        this.printToFileDir = printToFileDir;
    }

    public String getApiBaseUrl() {
        return apiBaseUrl;
    }

    public void setApiBaseUrl(String apiBaseUrl) {
        this.apiBaseUrl = apiBaseUrl;
    }

    public int getLedgerRetentionDays() {
        return ledgerRetentionDays;
    }

    public void setLedgerRetentionDays(int ledgerRetentionDays) {
        this.ledgerRetentionDays = ledgerRetentionDays;
    }

    public String getPrintToFileDir() {
        return printToFileDir;
    }

    public void setPrintToFileDir(String printToFileDir) {
        this.printToFileDir = printToFileDir;
    }

    public static AgentConfig load(Path configFile) {
        AgentConfig config = new AgentConfig();
        if (configFile != null && Files.isRegularFile(configFile)) {
            try {
                config = MAPPER.readValue(configFile.toFile(), AgentConfig.class);
            } catch (IOException e) {
                // Keep defaults if unreadable, same as C++ agent
            }
        }

        // Environment overrides
        String envApi = System.getenv("API_BASE_URL");
        if (envApi != null && !envApi.isBlank()) {
            config.setApiBaseUrl(envApi.trim());
        }

        String envDays = System.getenv("LEDGER_RETENTION_DAYS");
        if (envDays != null && !envDays.isBlank()) {
            try {
                int days = Integer.parseInt(envDays.trim());
                if (days > 0) {
                    config.setLedgerRetentionDays(days);
                }
            } catch (NumberFormatException ignored) {}
        }

        String envPrintToFile = System.getenv("PRINT_TO_FILE_DIR");
        if (envPrintToFile != null && !envPrintToFile.isBlank()) {
            config.setPrintToFileDir(envPrintToFile.trim());
        }

        return config;
    }
}
