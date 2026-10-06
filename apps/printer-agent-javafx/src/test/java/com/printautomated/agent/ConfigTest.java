package com.printautomated.agent;

import com.printautomated.agent.config.AgentConfig;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

public class ConfigTest {

    @Test
    void testDefaults() {
        AgentConfig config = AgentConfig.load(null);
        assertNotNull(config);
        assertEquals("https://api.printautomated.com", config.getApiBaseUrl());
        assertEquals(30, config.getLedgerRetentionDays());
    }

    @Test
    void testLoadJson(@TempDir Path tempDir) throws IOException {
        Path file = tempDir.resolve("config.json");
        String json = """
        {
            "apiBaseUrl": "http://localhost:3000",
            "ledgerRetentionDays": 60,
            "printToFileDir": "C:\\\\printed"
        }
        """;
        Files.writeString(file, json);

        AgentConfig config = AgentConfig.load(file);
        assertEquals("http://localhost:3000", config.getApiBaseUrl());
        assertEquals(60, config.getLedgerRetentionDays());
        assertEquals("C:\\printed", config.getPrintToFileDir());
    }
}
