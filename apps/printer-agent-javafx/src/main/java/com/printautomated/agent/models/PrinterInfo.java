package com.printautomated.agent.models;

public class PrinterInfo {
    private String name = "";
    private boolean isDefault = false;
    private boolean isColor = false;
    private boolean isDuplex = false;
    private boolean supportsA4 = false;
    private boolean supportsA3 = false;
    private String status = "Ready";

    public PrinterInfo() {}

    public PrinterInfo(String name, boolean isDefault, boolean isColor, boolean isDuplex,
                       boolean supportsA4, boolean supportsA3, String status) {
        this.name = name != null ? name : "";
        this.isDefault = isDefault;
        this.isColor = isColor;
        this.isDuplex = isDuplex;
        this.supportsA4 = supportsA4;
        this.supportsA3 = supportsA3;
        this.status = status != null ? status : "Ready";
    }

    public String getName() { return name; }
    public boolean isDefault() { return isDefault; }
    public boolean isColor() { return isColor; }
    public boolean isDuplex() { return isDuplex; }
    public boolean isSupportsA4() { return supportsA4; }
    public boolean isSupportsA3() { return supportsA3; }
    public String getStatus() { return status; }

    public void setName(String name) { this.name = name; }
    public void setDefault(boolean aDefault) { isDefault = aDefault; }
    public void setColor(boolean color) { isColor = color; }
    public void setDuplex(boolean duplex) { isDuplex = duplex; }
    public void setSupportsA4(boolean supportsA4) { this.supportsA4 = supportsA4; }
    public void setSupportsA3(boolean supportsA3) { this.supportsA3 = supportsA3; }
    public void setStatus(String status) { this.status = status; }
}
