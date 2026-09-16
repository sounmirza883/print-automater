import type { NotificationType } from "@prisma/client";

/** §7.4's own Done-when, honored here at the source rather than left
 * to whatever later renders these: "no internal terminology reaches
 * the customer" -- no enum names, no error codes, just plain language
 * naming the order by its public number. */
export function buildNotificationContent(
  type: NotificationType,
  publicOrderNumber: string,
): { subject: string; text: string } {
  switch (type) {
    case "PAYMENT_CONFIRMED":
      return {
        subject: `Payment confirmed for order ${publicOrderNumber}`,
        text: `We've received your payment for order ${publicOrderNumber}. The shop will review it shortly.`,
      };
    case "ORDER_ACCEPTED":
      return {
        subject: `Order ${publicOrderNumber} accepted`,
        text: `Good news -- order ${publicOrderNumber} has been accepted and will be printed soon.`,
      };
    case "PRINT_STARTED":
      return {
        subject: `Order ${publicOrderNumber} is printing`,
        text: `Order ${publicOrderNumber} is printing now.`,
      };
    case "PRINT_FAILED":
      return {
        subject: `A problem printing order ${publicOrderNumber}`,
        text: `We ran into a problem printing order ${publicOrderNumber}. The shop has been notified and will follow up with you.`,
      };
    case "PRINT_COMPLETED":
      return {
        subject: `Order ${publicOrderNumber} has printed`,
        text: `Order ${publicOrderNumber} has finished printing.`,
      };
    case "READY_FOR_COLLECTION":
      return {
        subject: `Order ${publicOrderNumber} is ready for collection`,
        text: `Order ${publicOrderNumber} is ready for you to collect at the shop.`,
      };
    case "ORDER_COMPLETED":
      return {
        subject: `Order ${publicOrderNumber} complete`,
        text: `Order ${publicOrderNumber} is complete. Thanks for using Print Automated.`,
      };
  }
}
