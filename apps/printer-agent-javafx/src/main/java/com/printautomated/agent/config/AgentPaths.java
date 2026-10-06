package com.printautomated.agent.config;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

public class AgentPaths {
    private final Path rootDir;
    private final Path configFile;
    private final Path identityFile;
    private final Path legacyIdentityFile;
    private final Path sessionFile;
    private final Path ledgerFile;
    private final Path logDir;
    private final Path tmpDir;

    public AgentPaths(Path rootDir) {
        this.rootDir = rootDir;
        this.configFile = rootDir.resolve("config.json");
        this.identityFile = rootDir.resolve("identity.dat");
        this.legacyIdentityFile = rootDir.resolve("identity.json");
        this.sessionFile = rootDir.resolve("session.dat");
        this.ledgerFile = rootDir.resolve("ledger.sqlite");
        this.logDir = rootDir.resolve("logs");
        this.tmpDir = rootDir.resolve("tmp");
    }

    public static AgentPaths defaultPaths() {
        String customHome = System.getenv("PRINT_AUTOMATED_AGENT_HOME");
        if (customHome != null && !customHome.isBlank()) {
            return new AgentPaths(Paths.get(customHome.trim()));
        }

        String localAppData = System.getenv("LOCALAPPDATA");
        if (localAppData != null && !localAppData.isBlank()) {
            return new AgentPaths(Paths.get(localAppData, "PrintAutomated"));
        }

        String userHome = System.getProperty("user.home", ".");
        return new AgentPaths(Paths.get(userHome, ".printautomated"));
    }

    public void ensureDirs() throws IOException {
        Files.createDirectories(rootDir);
        Files.createDirectories(logDir);
        Files.createDirectories(tmpDir);
    }

    public Path getRootDir() { return rootDir; }
    public Path getConfigFile() { return configFile; }
    public Path getIdentityFile() { return identityFile; }
    public Path getLegacyIdentityFile() { return legacyIdentityFile; }
    public Path getSessionFile() { return sessionFile; }
    public Path getLedgerFile() { return ledgerFile; }
    public Path getLogDir() { return logDir; }
    public Path getTmpDir() { return tmpDir; }
}
