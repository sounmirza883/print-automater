#include "backend/orders_client.h"

#include <cctype>
#include <cstdio>

namespace pa {

namespace {

std::string string_field(const nlohmann::json& object, const char* name) {
  if (!object.is_object() || !object.contains(name)) return {};
  const auto& value = object.at(name);
  return value.is_string() ? value.get<std::string>() : std::string();
}

std::optional<std::int64_t> integer_field(const nlohmann::json& object, const char* name) {
  if (!object.is_object() || !object.contains(name)) return std::nullopt;
  const auto& value = object.at(name);
  if (value.is_number_integer()) return value.get<std::int64_t>();
  return std::nullopt;
}

}  // namespace

OrderSummary parse_order(const nlohmann::json& order) {
  OrderSummary out;
  out.id = string_field(order, "id");
  out.order_number = string_field(order, "publicOrderNumber");
  out.customer_name = string_field(order, "customerName");
  out.document_filename = string_field(order, "documentFilename");
  out.order_status = string_field(order, "orderStatus");
  out.payment_status = string_field(order, "paymentStatus");
  out.created_at = string_field(order, "createdAt");
  out.printer_name = string_field(order, "printerName");

  if (order.is_object() && order.contains("pricingSnapshot") &&
      order.at("pricingSnapshot").is_object() && order.at("pricingSnapshot").contains("quote") &&
      order.at("pricingSnapshot").at("quote").is_object()) {
    const auto& quote = order.at("pricingSnapshot").at("quote");
    out.total_minor = integer_field(quote, "totalMinor");
    out.currency = string_field(quote, "currency");
  }
  return out;
}

OrdersPage parse_orders_page(const nlohmann::json& body) {
  if (!body.is_object() || !body.contains("items") || !body.at("items").is_array()) {
    throw BackendError("The API's order list is not in the expected shape.", "INVALID_RESPONSE",
                       true, 0);
  }
  OrdersPage page;
  for (const auto& item : body.at("items")) {
    if (item.is_object()) page.items.push_back(parse_order(item));
  }
  const auto total = integer_field(body, "total");
  page.total = total.value_or(static_cast<std::int64_t>(page.items.size()));
  return page;
}

std::optional<std::string> shop_id_from_me(const nlohmann::json& me) {
  if (!me.is_object() || !me.contains("shops") || !me.at("shops").is_array()) return std::nullopt;
  for (const auto& shop : me.at("shops")) {
    const std::string id = string_field(shop, "id");
    if (!id.empty()) return id;
  }
  return std::nullopt;
}

std::string order_status_label(std::string_view status) {
  std::string text;
  text.reserve(status.size());
  for (char c : status) text.push_back(c == '_' ? ' ' : static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
  if (!text.empty()) text[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(text[0])));
  return text;
}

std::string format_money(std::int64_t minor, const std::string& currency) {
  const bool negative = minor < 0;
  const std::uint64_t magnitude =
      negative ? 0ULL - static_cast<std::uint64_t>(minor) : static_cast<std::uint64_t>(minor);
  char buffer[48];
  std::snprintf(buffer, sizeof buffer, "%s%llu.%02llu", negative ? "-" : "",
                static_cast<unsigned long long>(magnitude / 100),
                static_cast<unsigned long long>(magnitude % 100));
  std::string text = buffer;
  if (!currency.empty()) text += " " + currency;
  return text;
}

std::string query_encode(std::string_view value) {
  std::string out;
  out.reserve(value.size());
  for (unsigned char c : value) {
    if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
      out.push_back(static_cast<char>(c));
    } else {
      char escaped[4];
      std::snprintf(escaped, sizeof escaped, "%%%02X", static_cast<unsigned>(c));
      out += escaped;
    }
  }
  return out;
}

OrdersClient::OrdersClient(ApiClient& api) : api_(api) {}

OrdersPage OrdersClient::fetch(std::size_t limit) {
  const auto shop_id = shop_id_from_me(api_.get("/v1/shop/staff/me"));
  if (!shop_id) {
    throw BackendError("Your account is not an active member of any business.", "NO_BUSINESS",
                       false, 0);
  }
  const std::string path = "/v1/shop/orders?shopId=" + query_encode(*shop_id) +
                           "&limit=" + std::to_string(limit) + "&offset=0";
  return parse_orders_page(api_.get(path));
}

}  // namespace pa
