// D51: the ASN clock. US retailers expect the 856 before the freight leaves (many require it within an hour of
// departure, and always before the truck arrives) and the goods by the PO's delivery date. A late or missing ASN
// is a common chargeback. These are inferred, labelled rules, not one retailer's routing guide.
export type TimingCheck = { key: "asn_after_ship" | "arrives_after_po_date" | "no_delivery_date"; tone: "bad" | "warn"; text: string };
export interface AsnTiming { deliverBy: string | null; checks: TimingCheck[]; onTime: boolean }

const iso = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

/** Timing of an ASN sent on `sentOn` (YYYY-MM-DD) for goods shipped on `shipDate` against the PO's delivery date. */
export function asnTiming(input: { requestedDelivery: string | null | undefined; shipDate: string | null | undefined;
  estimatedDelivery: string | null | undefined; sentOn: string }): AsnTiming {
  const deliverBy = iso(input.requestedDelivery);
  const ship = iso(input.shipDate);
  const eta = iso(input.estimatedDelivery);
  const checks: TimingCheck[] = [];
  if (ship && ship < input.sentOn) {
    checks.push({ key: "asn_after_ship", tone: "bad",
      text: `The goods left on ${ship} but the ASN goes out on ${input.sentOn}. Retailers expect it before the freight leaves; a late ASN is a common chargeback.` });
  }
  if (!eta) checks.push({ key: "no_delivery_date", tone: "warn", text: "No estimated delivery date: the retailer cannot plan the dock appointment." });
  else if (deliverBy && deliverBy < eta) {
    checks.push({ key: "arrives_after_po_date", tone: "warn",
      text: `Estimated delivery ${eta} is after the PO's delivery date ${deliverBy}. Expect an on-time-in-full penalty unless the buyer agreed.` });
  }
  return { deliverBy, checks, onTime: !checks.some((c) => c.tone === "bad") };
}
