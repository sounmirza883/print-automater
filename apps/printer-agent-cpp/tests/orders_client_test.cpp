#include <catch2/catch_test_macros.hpp>

#include <nlohmann/json.hpp>

#include "backend/orders_client.h"

using nlohmann::json;

namespace {

json full_order() {
  return json{{"id", "order-1"},
              {"publicOrderNumber", "PA-1001"},
              {"customerName", "Jess Printer"},
              {"documentFilename", "thesis.pdf"},
              {"orderStatus", "WAITING_FOR_SHOP"},
              {"paymentStatus", "PAID"},
              {"createdAt", "2026-09-28T10:00:00.000Z"},
              {"printerName", "Office Laser"},
              {"pricingSnapshot", {{"quote", {{"totalMinor", 1250}, {"currency", "GBP"}}}}}};
}

}  // namespace

TEST_CASE("parse_order reads every field of a complete order") {
  const pa::OrderSummary order = pa::parse_order(full_order());

  CHECK(order.id == "order-1");
  CHECK(order.order_number == "PA-1001");
  CHECK(order.customer_name == "Jess Printer");
  CHECK(order.document_filename == "thesis.pdf");
  CHECK(order.order_status == "WAITING_FOR_SHOP");
  CHECK(order.payment_status == "PAID");
  CHECK(order.created_at == "2026-09-28T10:00:00.000Z");
  CHECK(order.printer_name == "Office Laser");
  REQUIRE(order.total_minor.has_value());
  CHECK(*order.total_minor == 1250);
  CHECK(order.currency == "GBP");
}

TEST_CASE("parse_order treats missing optional fields as empty, never as an error") {
  const json sparse = {{"id", "order-2"}, {"publicOrderNumber", "PA-1002"}};
  const pa::OrderSummary order = pa::parse_order(sparse);

  CHECK(order.id == "order-2");
  CHECK(order.order_number == "PA-1002");
  CHECK(order.customer_name.empty());
  CHECK(order.order_status.empty());
  CHECK(order.printer_name.empty());
  CHECK(order.created_at.empty());
  CHECK_FALSE(order.total_minor.has_value());
  CHECK(order.currency.empty());
}

TEST_CASE("parse_order accepts a null printerName and a quote-less pricing snapshot") {
  json order = full_order();
  order["printerName"] = nullptr;
  order["pricingSnapshot"] = json::object();

  const pa::OrderSummary parsed = pa::parse_order(order);
  CHECK(parsed.printer_name.empty());
  CHECK_FALSE(parsed.total_minor.has_value());
}

TEST_CASE("parse_order ignores fields of the wrong type") {
  json order = full_order();
  order["publicOrderNumber"] = 42;
  order["customerName"] = json::array({"not", "a", "string"});
  order["pricingSnapshot"]["quote"]["totalMinor"] = "1250";  // a string, not a number
  order["pricingSnapshot"]["quote"]["currency"] = 978;

  const pa::OrderSummary parsed = pa::parse_order(order);
  CHECK(parsed.order_number.empty());
  CHECK(parsed.customer_name.empty());
  CHECK_FALSE(parsed.total_minor.has_value());
  CHECK(parsed.currency.empty());
  CHECK(parsed.order_status == "WAITING_FOR_SHOP");  // untouched fields still read
}

TEST_CASE("parse_order does not treat a fractional total as an integer") {
  json order = full_order();
  order["pricingSnapshot"]["quote"]["totalMinor"] = 12.5;

  CHECK_FALSE(pa::parse_order(order).total_minor.has_value());
}

TEST_CASE("parse_order of a non-object is an empty order, not a crash") {
  const pa::OrderSummary parsed = pa::parse_order(json("nonsense"));
  CHECK(parsed.id.empty());
  CHECK_FALSE(parsed.total_minor.has_value());
}

TEST_CASE("parse_orders_page reads items and total") {
  const json body = {{"items", json::array({full_order(), full_order()})}, {"total", 7}};
  const pa::OrdersPage page = pa::parse_orders_page(body);

  CHECK(page.items.size() == 2);
  CHECK(page.total == 7);
  CHECK(page.items[0].order_number == "PA-1001");
}

TEST_CASE("parse_orders_page skips non-object rows and falls back to the item count") {
  const json body = {{"items", json::array({full_order(), 5, nullptr, full_order()})},
                     {"total", "many"}};
  const pa::OrdersPage page = pa::parse_orders_page(body);

  CHECK(page.items.size() == 2);
  CHECK(page.total == 2);
}

TEST_CASE("parse_orders_page with no items is an empty page") {
  const pa::OrdersPage page = pa::parse_orders_page(json{{"items", json::array()}, {"total", 0}});
  CHECK(page.items.empty());
  CHECK(page.total == 0);
}

TEST_CASE("parse_orders_page refuses a body that is not the list shape") {
  const auto expect_invalid = [](const json& body) {
    try {
      (void)pa::parse_orders_page(body);
      FAIL("expected a BackendError");
    } catch (const pa::BackendError& error) {
      CHECK(error.error_code() == "INVALID_RESPONSE");
    }
  };

  expect_invalid(json::array({full_order()}));                 // a bare array, not a page
  expect_invalid(json{{"total", 1}});                          // no items
  expect_invalid(json{{"items", "PA-1001"}, {"total", 1}});    // items not an array
  expect_invalid(json("nonsense"));
}

TEST_CASE("shop_id_from_me takes the first business the caller belongs to") {
  const json me = {{"user", {{"id", "u1"}}},
                   {"shops", json::array({{{"id", "shop-a"}, {"name", "A"}, {"role", "SHOP_OWNER"}},
                                          {{"id", "shop-b"}, {"name", "B"}}})}};
  REQUIRE(pa::shop_id_from_me(me).has_value());
  CHECK(*pa::shop_id_from_me(me) == "shop-a");
}

TEST_CASE("shop_id_from_me is empty when there is no membership or the body is malformed") {
  CHECK_FALSE(pa::shop_id_from_me(json{{"shops", json::array()}}).has_value());
  CHECK_FALSE(pa::shop_id_from_me(json{{"user", {{"id", "u1"}}}}).has_value());
  CHECK_FALSE(pa::shop_id_from_me(json{{"shops", "shop-a"}}).has_value());
  CHECK_FALSE(pa::shop_id_from_me(json{{"shops", json::array({{{"id", 7}}})}}).has_value());
  CHECK_FALSE(pa::shop_id_from_me(json::array()).has_value());
}

TEST_CASE("order_status_label matches shop-web's humanizeEnum") {
  CHECK(pa::order_status_label("PAYMENT_PENDING") == "Payment pending");
  CHECK(pa::order_status_label("WAITING_FOR_SHOP") == "Waiting for shop");
  CHECK(pa::order_status_label("QUALITY_CHECK") == "Quality check");
  CHECK(pa::order_status_label("PAID") == "Paid");
  CHECK(pa::order_status_label("") == "");
}

TEST_CASE("format_money renders minor units with two decimals and the currency") {
  CHECK(pa::format_money(1250, "GBP") == "12.50 GBP");
  CHECK(pa::format_money(5, "") == "0.05");
  CHECK(pa::format_money(0, "GBP") == "0.00 GBP");
  CHECK(pa::format_money(100000, "EUR") == "1000.00 EUR");
  CHECK(pa::format_money(-250, "GBP") == "-2.50 GBP");
}

TEST_CASE("query_encode escapes everything outside the unreserved set") {
  CHECK(pa::query_encode("shop-1_a.b~c") == "shop-1_a.b~c");
  CHECK(pa::query_encode("a b&c=d") == "a%20b%26c%3Dd");
  CHECK(pa::query_encode("") == "");
}
