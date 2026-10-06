package com.printautomated.agent.models;

public class OrderSummary {
    private String id = "";
    private String orderNumber = "";
    private String orderStatus = "";
    private String paymentStatus = "";
    private String customerName = "";
    private String totalFormatted = "";
    private String createdAt = "";
    private String documentTitle = "";

    public OrderSummary() {}

    public OrderSummary(String id, String orderNumber, String orderStatus, String paymentStatus,
                        String customerName, String totalFormatted, String createdAt, String documentTitle) {
        this.id = id != null ? id : "";
        this.orderNumber = orderNumber != null ? orderNumber : "";
        this.orderStatus = orderStatus != null ? orderStatus : "";
        this.paymentStatus = paymentStatus != null ? paymentStatus : "";
        this.customerName = customerName != null ? customerName : "";
        this.totalFormatted = totalFormatted != null ? totalFormatted : "";
        this.createdAt = createdAt != null ? createdAt : "";
        this.documentTitle = documentTitle != null ? documentTitle : "";
    }

    public String getId() { return id; }
    public String getOrderNumber() { return orderNumber; }
    public String getOrderStatus() { return orderStatus; }
    public String getPaymentStatus() { return paymentStatus; }
    public String getCustomerName() { return customerName; }
    public String getTotalFormatted() { return totalFormatted; }
    public String getCreatedAt() { return createdAt; }
    public String getDocumentTitle() { return documentTitle; }

    public void setId(String id) { this.id = id; }
    public void setOrderNumber(String orderNumber) { this.orderNumber = orderNumber; }
    public void setOrderStatus(String orderStatus) { this.orderStatus = orderStatus; }
    public void setPaymentStatus(String paymentStatus) { this.paymentStatus = paymentStatus; }
    public void setCustomerName(String customerName) { this.customerName = customerName; }
    public void setTotalFormatted(String totalFormatted) { this.totalFormatted = totalFormatted; }
    public void setCreatedAt(String createdAt) { this.createdAt = createdAt; }
    public void setDocumentTitle(String documentTitle) { this.documentTitle = documentTitle; }
}
