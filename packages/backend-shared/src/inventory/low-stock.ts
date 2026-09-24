/** §32: an item is "low" once its quantity has reached its configured minimum.
 * A minimum of 0 means "no alert configured", so it is never low (an item that
 * is out of stock with no minimum is simply empty, not an alert). The ONE
 * definition: the list filter, the API `lowStock` flag and the alert worker
 * (20.5) all use it (the worker's SQL mirrors it and is tested against it). */
export function isLowStock(quantity: number, minQuantity: number): boolean {
  return minQuantity > 0 && quantity <= minQuantity;
}
