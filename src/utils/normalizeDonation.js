/**
 * Normalize donation amount for UI display.
 * Accepts cents or legacy dollars and always returns dollars (number).
 */
export function normalizeDonationAmount(rawAmount) {
  if (rawAmount == null) return 0;

  const amount = Number(rawAmount);

  // Heuristic:
  // - Stripe amounts are always >= 100 (cents)
  // - Legacy demo data may be <= 100 (already dollars)
  if (amount >= 100) {
    return amount / 100;
  }

  return amount;
}
