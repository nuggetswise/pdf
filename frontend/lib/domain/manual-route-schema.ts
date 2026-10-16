// The administrator's Act 1 assumptions (D49), kept apart so run-state.ts can import them without a cycle.
import { z } from "zod";

const decimalText = z.string().regex(/^\d{1,7}(\.\d{1,4})?$/);

export const ManualRouteAssumptions = z.strictObject({
  /** Seconds to read and key one field by hand. */
  secondsPerField: decimalText,
  /** Fully loaded cost of the person keying, USD per hour. */
  hourlyRate: decimalText,
  /** Chance (percent) that a retyped ASN reaches the retailer after the freight. */
  lateAsnChancePercent: decimalText,
  /** Late-ASN chargeback, percent of the order value. */
  lateAsnPenaltyPercent: decimalText,
  /** Flat chargeback per PO when the ASN's items do not match what arrives (wrong or retired GTIN). */
  asnMismatchFee: decimalText,
  /** Chance (percent) that any one retyped field is keyed wrong. */
  keyingErrorPercent: decimalText,
});
export type ManualRouteAssumptions = z.infer<typeof ManualRouteAssumptions>;

/** Example values, each traceable to the review doc's sources; an administrator edits them per demo. */
export const DEFAULT_ASSUMPTIONS: ManualRouteAssumptions = {
  secondsPerField: "20",
  hourlyRate: "30.00",
  lateAsnChancePercent: "10",
  lateAsnPenaltyPercent: "2",
  asnMismatchFee: "50.00",
  keyingErrorPercent: "1",
};

export const ASSUMPTION_LABELS: Record<keyof ManualRouteAssumptions, string> = {
  secondsPerField: "Seconds to key one field",
  hourlyRate: "Cost of the person keying (USD per hour)",
  lateAsnChancePercent: "Chance a retyped ASN arrives late (%)",
  lateAsnPenaltyPercent: "Late-ASN chargeback (% of order value)",
  asnMismatchFee: "ASN item mismatch chargeback (USD per PO)",
  keyingErrorPercent: "Chance one field is keyed wrong (%)",
};

