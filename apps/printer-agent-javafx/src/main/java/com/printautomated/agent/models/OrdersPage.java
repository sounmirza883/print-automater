package com.printautomated.agent.models;

import java.util.ArrayList;
import java.util.List;

public class OrdersPage {
    private List<OrderSummary> items = new ArrayList<>();
    private long total = 0;

    public OrdersPage() {}

    public OrdersPage(List<OrderSummary> items, long total) {
        this.items = items != null ? items : new ArrayList<>();
        this.total = total;
    }

    public List<OrderSummary> getItems() { return items; }
    public long getTotal() { return total; }

    public void setItems(List<OrderSummary> items) { this.items = items; }
    public void setTotal(long total) { this.total = total; }
}
