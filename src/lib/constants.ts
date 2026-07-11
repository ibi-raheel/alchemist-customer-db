// Loyalty rules (display copy + client-side hints only — the DB is the source
// of truth and enforces these in 0002_functions_rls.sql).
export const PKR_PER_POINT_EARNED = 100; // earn 1 point per PKR 100 spent
export const RUPEE_VALUE_PER_POINT = 1; // redeem: 1 point = PKR 1
export const MIN_REDEEM_BALANCE = 100; // need >= 100 points to redeem

export function pointsForAmount(amount: number): number {
  return Math.floor(amount / PKR_PER_POINT_EARNED);
}
