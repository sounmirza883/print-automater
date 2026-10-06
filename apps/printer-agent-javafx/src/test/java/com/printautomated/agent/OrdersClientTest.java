package com.printautomated.agent;

import com.printautomated.agent.backend.OrdersClient;
import com.printautomated.agent.models.OrderSummary;
import com.printautomated.agent.models.OrdersPage;
import org.junit.jupiter.api.Test;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.*;

public class OrdersClientTest {

    @Test
    void testHumanizeEnum() {
        assertEquals("Draft", OrdersClient.humanizeEnum("DRAFT"));
        assertEquals("Payment pending", OrdersClient.humanizeEnum("PAYMENT_PENDING"));
        assertEquals("Paid", OrdersClient.humanizeEnum("PAID"));
        assertEquals("In production", OrdersClient.humanizeEnum("IN_PRODUCTION"));
        assertEquals("Ready for pickup", OrdersClient.humanizeEnum("READY_FOR_PICKUP"));
        assertEquals("Completed", OrdersClient.humanizeEnum("COMPLETED"));
        assertEquals("Cancelled", OrdersClient.humanizeEnum("CANCELLED"));
        assertEquals("-", OrdersClient.humanizeEnum(""));
    }

    @Test
    void testFormatMoney() {
        assertEquals("$12.50", OrdersClient.formatMoney(1250, "USD"));
        assertEquals("$0.00", OrdersClient.formatMoney(0, "USD"));
        assertEquals("$100.00", OrdersClient.formatMoney(10000, "USD"));
    }

    @Test
    void testParseOrdersPageJson() throws IOException {
        String json = """
        {
            "items": [
                {
                    "id": "ord_1001",
                    "orderNumber": "ORD-001",
                    "orderStatus": "IN_PRODUCTION",
                    "paymentStatus": "PAID",
                    "customer": {
                        "fullName": "Jane Doe",
                        "email": "jane@example.com"
                    },
                    "totalAmount": 2500,
                    "currency": "USD",
                    "createdAt": "2026-10-06T10:00:00.000Z",
                    "items": [
                        {
                            "document": {
                                "fileName": "Brochure.pdf"
                            }
                        }
                    ]
                }
            ],
            "total": 1
        }
        """;

        OrdersPage page = OrdersClient.parseOrdersPage(json);
        assertNotNull(page);
        assertEquals(1, page.getTotal());
        assertEquals(1, page.getItems().size());

        OrderSummary item = page.getItems().get(0);
        assertEquals("ord_1001", item.getId());
        assertEquals("ORD-001", item.getOrderNumber());
        assertEquals("In production", item.getOrderStatus());
        assertEquals("Paid", item.getPaymentStatus());
        assertEquals("Jane Doe", item.getCustomerName());
        assertEquals("$25.00", item.getTotalFormatted());
        assertEquals("Brochure.pdf", item.getDocumentTitle());
    }
}
