#pragma once

#include <nlohmann/json.hpp>

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "backend/api_client.h"

namespace pa {

/// One row of the native Orders/Queue list: the fields apps/shop-web's OrdersScreen shows on each
/// order row, read from GET /v1/shop/orders (services/api ShopOrdersService.ShopOrderResponse).
/// Enum values are kept as the API's own strings; order_status_label() turns them into text.
struct OrderSummary {
  std::string id;
  std::string order_number;     // publicOrderNumber
  std::string customer_name;    // customerName
  std::string document_filename;
  std::string order_status;     // orderStatus, e.g. "WAITING_FOR_SHOP"
  std::string payment_status;   // paymentStatus, e.g. "PAID"
  std::string created_at;       // ISO-8601 UTC, as sent
  std::string printer_name;     // printerName ("" when no printer yet)
  /// pricingSnapshot.quote.totalMinor and .currency; nullopt when the order has no quote.
  std::optional<std::int64_t> total_minor;
  std::string currency;
};

/// One page of the order list: `items` newest first, `total` the matching rows across all pages.
struct OrdersPage {
  std::vector<OrderSummary> items;
  std::int64_t total = 0;
};

/// Reads one order defensively: a missing or wrongly-typed field becomes its empty/nullopt
/// value, never an exception, so one odd row cannot blank the whole list.
OrderSummary parse_order(const nlohmann::json& order);

/// Reads a GET /v1/shop/orders page. Throws BackendError("INVALID_RESPONSE") when the body is not
/// an object with an `items` array (nothing sensible can be shown then). Array entries that are
/// not objects are skipped. A missing or non-numeric `total` falls back to the number of items.
OrdersPage parse_orders_page(const nlohmann::json& body);

/// The first business in GET /v1/shop/staff/me, the same default apps/shop-web picks when no
/// business was chosen. nullopt when the caller has no active membership or the body is malformed.
std::optional<std::string> shop_id_from_me(const nlohmann::json& me);

/// The API's enum spelled the way shop-web's humanizeEnum does: "PAYMENT_PENDING" becomes
/// "Payment pending". Empty in, empty out.
std::string order_status_label(std::string_view status);

/// Minor units to text with two decimals and an optional currency code: (1250, "GBP") becomes
/// "12.50 GBP". Assumes a two-decimal currency, which holds for every currency this product
/// sells in today.
std::string format_money(std::int64_t minor, const std::string& currency);

/// Percent-encodes everything outside RFC 3986's unreserved set, for query-string values.
std::string query_encode(std::string_view value);

/// Fetches the signed-in staff member's Orders/Queue list through ApiClient, against the same two
/// endpoints apps/shop-web uses: /v1/shop/staff/me to find the business, then /v1/shop/orders
/// with shopId, limit and offset (no group filter: every visible order, newest first). Blocking;
/// call it off the UI thread. Errors surface as BackendError from ApiClient.
class OrdersClient {
 public:
  explicit OrdersClient(ApiClient& api);

  OrdersPage fetch(std::size_t limit = 50);

 private:
  ApiClient& api_;
};

}  // namespace pa
