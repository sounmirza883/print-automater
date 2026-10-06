package com.printautomated.agent.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.printautomated.agent.models.OrderSummary;
import com.printautomated.agent.models.OrdersPage;

import java.io.IOException;
import java.net.http.HttpResponse;
import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.Currency;
import java.util.List;
import java.util.Locale;

public class OrdersClient {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final ApiClient apiClient;

    public OrdersClient(ApiClient apiClient) {
        this.apiClient = apiClient;
    }

    public OrdersPage fetchOrders(int limit, int offset) throws IOException, InterruptedException {
        String shopId = resolveActiveShopId();
        if (shopId == null || shopId.isBlank()) {
            return new OrdersPage(List.of(), 0);
        }

        String path = String.format("/v1/shop/orders?shopId=%s&limit=%d&offset=%d", shopId, limit, offset);
        HttpResponse<String> response = apiClient.get(path);
        if (response.statusCode() != 200) {
            throw new IOException("Failed to fetch orders, HTTP " + response.statusCode());
        }

        return parseOrdersPage(response.body());
    }

    public String resolveActiveShopId() throws IOException, InterruptedException {
        HttpResponse<String> response = apiClient.get("/v1/shop/staff/me");
        if (response.statusCode() != 200) {
            return null;
        }

        JsonNode root = MAPPER.readTree(response.body());
        JsonNode data = root.has("data") ? root.get("data") : root;

        if (data.has("activeShopId") && !data.get("activeShopId").asText().isBlank()) {
            return data.get("activeShopId").asText();
        }

        if (data.has("business") && data.get("business").has("id")) {
            return data.get("business").get("id").asText();
        }

        if (data.has("memberships") && data.get("memberships").isArray() && !data.get("memberships").isEmpty()) {
            JsonNode first = data.get("memberships").get(0);
            if (first.has("shopId")) {
                return first.get("shopId").asText();
            }
        }

        return null;
    }

    public static OrdersPage parseOrdersPage(String json) throws IOException {
        JsonNode root = MAPPER.readTree(json);
        JsonNode data = root.has("data") ? root.get("data") : root;

        List<OrderSummary> items = new ArrayList<>();
        long total = 0;

        JsonNode itemsNode = data.has("items") ? data.get("items") : (data.isArray() ? data : null);
        if (itemsNode != null && itemsNode.isArray()) {
            for (JsonNode item : itemsNode) {
                items.add(parseOrderSummary(item));
            }
        }

        if (data.has("total")) {
            total = data.get("total").asLong(items.size());
        } else if (data.has("pagination") && data.get("pagination").has("total")) {
            total = data.get("pagination").get("total").asLong(items.size());
        } else {
            total = items.size();
        }

        return new OrdersPage(items, total);
    }

    public static OrderSummary parseOrderSummary(JsonNode node) {
        String id = node.path("id").asText("");
        String orderNumber = node.path("orderNumber").asText(node.path("number").asText(id.length() > 8 ? id.substring(0, 8) : id));

        String rawOrderStatus = node.path("orderStatus").asText(node.path("status").asText(""));
        String orderStatus = humanizeEnum(rawOrderStatus);

        String rawPaymentStatus = node.path("paymentStatus").asText("");
        String paymentStatus = humanizeEnum(rawPaymentStatus);

        String customerName = "Guest / Counter";
        if (node.has("customer") && !node.get("customer").isNull()) {
            JsonNode cust = node.get("customer");
            customerName = cust.path("name").asText(cust.path("fullName").asText(cust.path("email").asText("Customer")));
        } else if (node.has("customerName") && !node.get("customerName").asText().isBlank()) {
            customerName = node.get("customerName").asText();
        }

        String totalFormatted = "$0.00";
        if (node.has("totalAmount") || node.has("total")) {
            long cents = node.path("totalAmount").asLong(node.path("total").asLong(0));
            String currency = node.path("currency").asText("USD");
            totalFormatted = formatMoney(cents, currency);
        }

        String createdAt = node.path("createdAt").asText("");
        String documentTitle = "-";
        if (node.has("items") && node.get("items").isArray() && !node.get("items").isEmpty()) {
            JsonNode firstItem = node.get("items").get(0);
            if (firstItem.has("document") && !firstItem.get("document").isNull()) {
                documentTitle = firstItem.get("document").path("fileName").asText(firstItem.get("document").path("title").asText("-"));
            } else if (firstItem.has("documentTitle")) {
                documentTitle = firstItem.path("documentTitle").asText("-");
            }
        } else if (node.has("documentTitle")) {
            documentTitle = node.path("documentTitle").asText("-");
        }

        return new OrderSummary(id, orderNumber, orderStatus, paymentStatus, customerName, totalFormatted, createdAt, documentTitle);
    }

    public static String humanizeEnum(String value) {
        if (value == null || value.isBlank()) return "-";
        switch (value.toUpperCase()) {
            case "DRAFT": return "Draft";
            case "PAYMENT_PENDING": return "Payment pending";
            case "PAID": return "Paid";
            case "CREATED": return "Created";
            case "CONFIRMED": return "Confirmed";
            case "IN_PRODUCTION": return "In production";
            case "READY_FOR_PICKUP": return "Ready for pickup";
            case "COMPLETED": return "Completed";
            case "CANCELLED": return "Cancelled";
            case "REFUNDED": return "Refunded";
            case "PENDING": return "Pending";
            case "FAILED": return "Failed";
            case "UNKNOWN": return "Unknown";
            default:
                String[] words = value.toLowerCase().replace('_', ' ').split("\\s+");
                StringBuilder sb = new StringBuilder();
                for (String word : words) {
                    if (!word.isEmpty()) {
                        sb.append(Character.toUpperCase(word.charAt(0))).append(word.substring(1)).append(" ");
                    }
                }
                return sb.toString().trim();
        }
    }

    public static String formatMoney(long minorUnits, String currencyCode) {
        try {
            Currency currency = Currency.getInstance(currencyCode != null && !currencyCode.isBlank() ? currencyCode : "USD");
            NumberFormat format = NumberFormat.getCurrencyInstance(Locale.US);
            format.setCurrency(currency);
            return format.format(minorUnits / 100.0);
        } catch (Exception e) {
            return String.format("$%.2f", minorUnits / 100.0);
        }
    }
}
