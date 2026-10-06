package com.printautomated.agent.models;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public class AgentStatus {
    @JsonProperty("paired")
    private boolean paired = false;

    @JsonProperty("pairing")
    private boolean pairing = false;

    @JsonProperty("shop")
    private String shop = "";

    @JsonProperty("device")
    private String device = "";

    @JsonProperty("lastHeartbeatAt")
    private String lastHeartbeatAt = "";

    @JsonProperty("printers")
    private int printers = 0;

    @JsonProperty("lastJob")
    private String lastJob = "";

    @JsonProperty("lastError")
    private String lastError = "";

    public AgentStatus() {}

    public boolean isPaired() { return paired; }
    public boolean isPairing() { return pairing; }
    public String getShop() { return shop; }
    public String getDevice() { return device; }
    public String getLastHeartbeatAt() { return lastHeartbeatAt; }
    public int getPrinters() { return printers; }
    public String getLastJob() { return lastJob; }
    public String getLastError() { return lastError; }

    public void setPaired(boolean paired) { this.paired = paired; }
    public void setPairing(boolean pairing) { this.pairing = pairing; }
    public void setShop(String shop) { this.shop = shop; }
    public void setDevice(String device) { this.device = device; }
    public void setLastHeartbeatAt(String lastHeartbeatAt) { this.lastHeartbeatAt = lastHeartbeatAt; }
    public void setPrinters(int printers) { this.printers = printers; }
    public void setLastJob(String lastJob) { this.lastJob = lastJob; }
    public void setLastError(String lastError) { this.lastError = lastError; }
}
