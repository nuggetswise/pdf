// The sample inbox (D71): eighteen fictional purchase-order emails with PDF attachments, labelled as samples.
// Each one is read, matched and checked by the same rules a real order goes through (engine.ts); nothing here
// states an outcome. Scenario notes are for developers and tests only and never reach the screen.
import { BUYERS, SUPPLIER } from "./reference";
import type { PrintedLine, PrintedPo } from "./types";

export type SampleEmail = {
  id: string;
  minutesAgo: number;
  fromName: string;
  fromUser: string;
  buyerId: string;
  subject: string;
  body: string[];
  po: PrintedPo;
  /** Developer note: which scenario of the brief this sample exercises. */
  scenario: "straight_through" | "unit_recommendation" | "ambiguous_product" | "blocked_location" | "erp_rejection"
    | "price_recommendation";
};

const buyer = (id: string) => BUYERS.find((b) => b.id === id)!;
const ln = (line: number, itemCode: string | null, description: string, quantity: string, unit: string, unitPrice: string): PrintedLine =>
  ({ line, itemCode, description, quantity, unit, unitPrice });

function po(buyerId: string, poNumber: string | null, shipTo: string | null | "none", orderDate: string, deliveryDate: string,
  lines: PrintedLine[], notes: string[] = []): PrintedPo {
  const b = buyer(buyerId);
  const loc = shipTo && shipTo !== "none" ? b.locations.find((l) => l.code === shipTo) : null;
  return {
    poNumber, orderDate, buyerName: b.name, buyerAddress: [`${b.name} Purchasing`, "Fictional sample address"],
    supplierName: SUPPLIER.name,
    shipTo: shipTo === "none" ? null : { code: loc?.code ?? shipTo, name: loc?.name ?? "", address: loc ? [loc.address] : [] },
    deliveryDate, currency: "USD", terms: "Net 30", lines, notes: ["Sample document. Fictional data.", ...notes],
  };
}

const NORMAL_BODY = ["Hello,", "Please find our purchase order attached.", "Thank you."];

export const SAMPLES: SampleEmail[] = [
  { id: "ord-1001", minutesAgo: 412, fromName: "Maya Chen", fromUser: "purchasing", buyerId: "HARBORVIEW", subject: "Purchase order HV-88190",
    body: NORMAL_BODY, scenario: "straight_through",
    po: po("HARBORVIEW", "HV-88190", "HV-DC1", "2026-10-15", "2026-10-24", [ln(1, "NB-1003", "Fizz Classic Cola 330 mL x 24", "60", "CASE", "16.20"),
      ln(2, "NB-5001", "Ginger Ale 355 mL x 24", "24", "CASE", "14.10")]) },
  { id: "ord-1002", minutesAgo: 398, fromName: "Dana Ruiz", fromUser: "buying", buyerId: "SUMMIT", subject: "PO SG-55101",
    body: NORMAL_BODY, scenario: "straight_through",
    po: po("SUMMIT", "SG-55101", "SG-DC03", "2026-10-15", "2026-10-23", [ln(1, "NB-4001", "Still Spring Water 500 mL x 24", "120", "CASE", "6.40")]) },
  { id: "ord-1003", minutesAgo: 381, fromName: "Sam Okafor", fromUser: "orders", buyerId: "LAKESHORE", subject: "New PO LF-20402",
    body: NORMAL_BODY, scenario: "straight_through",
    po: po("LAKESHORE", "LF-20402", "LF-DC1", "2026-10-15", "2026-10-25", [ln(1, "NB-6001", "Iced Tea Peach 500 mL x 12", "36", "CASE", "11.25"),
      ln(2, "NB-4002", "Still Spring Water 1.5 L x 12", "48", "CASE", "7.90")]) },
  { id: "ord-1004", minutesAgo: 366, fromName: "Priya Nair", fromUser: "replenishment", buyerId: "PRAIRIE", subject: "Purchase order PF-7720",
    body: NORMAL_BODY, scenario: "straight_through",
    po: po("PRAIRIE", "PF-7720", "PF-DC1", "2026-10-15", "2026-10-26", [ln(1, "NB-1001", "Fizz Zero Cola 330 mL x 24", "40", "CASE", "16.80")]) },
  { id: "ord-1005", minutesAgo: 344, fromName: "Maya Chen", fromUser: "purchasing", buyerId: "HARBORVIEW", subject: "Purchase order HV-88197",
    body: NORMAL_BODY, scenario: "straight_through",
    po: po("HARBORVIEW", "HV-88197", "HV-DC2", "2026-10-16", "2026-10-27", [ln(1, "NB-4001", "Still Spring Water 500 mL x 24", "80", "CASE", "6.40"),
      ln(2, "NB-6001", "Iced Tea Peach 500 mL x 12", "30", "CASE", "11.25")]) },
  { id: "ord-1006", minutesAgo: 322, fromName: "Dana Ruiz", fromUser: "buying", buyerId: "SUMMIT", subject: "PO SG-55109",
    body: NORMAL_BODY, scenario: "straight_through",
    po: po("SUMMIT", "SG-55109", "SG-DC03", "2026-10-16", "2026-10-24", [ln(1, "NB-5001", "Ginger Ale 355 mL x 24", "36", "CASE", "14.10")]) },
  { id: "ord-1007", minutesAgo: 301, fromName: "Sam Okafor", fromUser: "orders", buyerId: "LAKESHORE", subject: "New PO LF-20407",
    body: NORMAL_BODY, scenario: "straight_through",
    po: po("LAKESHORE", "LF-20407", "LF-DC1", "2026-10-16", "2026-10-28", [ln(1, "NB-1003", "Fizz Classic Cola 330 mL x 24", "45", "CASE", "16.20")]) },
  { id: "ord-1008", minutesAgo: 276, fromName: "Priya Nair", fromUser: "replenishment", buyerId: "PRAIRIE", subject: "Purchase order PF-7724",
    body: NORMAL_BODY, scenario: "straight_through",
    po: po("PRAIRIE", "PF-7724", "PF-DC2", "2026-10-16", "2026-10-27", [ln(1, "NB-4002", "Still Spring Water 1.5 L x 12", "64", "CASE", "7.90"),
      ln(2, "NB-5001", "Ginger Ale 355 mL x 24", "20", "CASE", "14.10")]) },
  { id: "ord-1009", minutesAgo: 248, fromName: "Dana Ruiz", fromUser: "buying", buyerId: "SUMMIT", subject: "PO SG-55120",
    body: ["Hello,", "Attached is PO SG-55120 for the Fort Wayne DC.", "Thanks, Dana"], scenario: "unit_recommendation",
    po: po("SUMMIT", "SG-55120", "SG-DC03", "2026-10-16", "2026-10-26", [ln(1, "NB-2001", "Sparkling Water Lemon 355 mL", "24", "CASE", "9.60"),
      ln(2, "NB-5001", "Ginger Ale 355 mL x 24", "10", "CASE", "14.10")]) },
  { id: "ord-1010", minutesAgo: 219, fromName: "Maya Chen", fromUser: "purchasing", buyerId: "HARBORVIEW", subject: "Purchase order HV-88213",
    body: ["Hi team,", "PO HV-88213 attached. Please confirm.", "Maya"], scenario: "ambiguous_product",
    po: po("HARBORVIEW", "HV-88213", "HV-DC1", "2026-10-16", "2026-10-29", [ln(1, null, "Fizz Zero 24 Pack", "40", "CASE", "16.80"),
      ln(2, "NB-4001", "Still Spring Water 500 mL x 24", "30", "CASE", "6.40")]) },
  { id: "ord-1011", minutesAgo: 187, fromName: "Priya Nair", fromUser: "replenishment", buyerId: "PRAIRIE", subject: "Purchase order PF-7731",
    body: ["Hello,", "Please deliver as usual.", "Priya"], scenario: "blocked_location",
    po: po("PRAIRIE", "PF-7731", "none", "2026-10-17", "2026-10-30", [ln(1, "NB-6001", "Iced Tea Peach 500 mL x 12", "20", "CASE", "11.25")]) },
  { id: "ord-1012", minutesAgo: 163, fromName: "Dana Ruiz", fromUser: "buying", buyerId: "SUMMIT", subject: "PO SG-55134",
    body: ["Hello,", "PO SG-55134 for the Indianapolis DC is attached.", "Dana"], scenario: "erp_rejection",
    po: po("SUMMIT", "SG-55134", "SG-DC14", "2026-10-17", "2026-10-28", [ln(1, "NB-1003", "Fizz Classic Cola 330 mL x 24", "50", "CASE", "16.20"),
      ln(2, "NB-4002", "Still Spring Water 1.5 L x 12", "40", "CASE", "7.90")]) },
  { id: "ord-1013", minutesAgo: 141, fromName: "Sam Okafor", fromUser: "orders", buyerId: "LAKESHORE", subject: "New PO LF-20419",
    body: ["Hi,", "New order attached.", "Sam"], scenario: "price_recommendation",
    po: po("LAKESHORE", "LF-20419", "LF-DC1", "2026-10-17", "2026-10-30", [ln(1, "NB-3001", "Cold Brew Coffee 250 mL x 12", "40", "CASE", "18.75")]) },
  { id: "ord-1014", minutesAgo: 118, fromName: "Maya Chen", fromUser: "purchasing", buyerId: "HARBORVIEW", subject: "Purchase order HV-88220",
    body: NORMAL_BODY, scenario: "straight_through",
    po: po("HARBORVIEW", "HV-88220", "HV-DC1", "2026-10-17", "2026-10-29", [ln(1, "NB-5001", "Ginger Ale 355 mL x 24", "48", "CASE", "14.10")]) },
  { id: "ord-1015", minutesAgo: 96, fromName: "Priya Nair", fromUser: "replenishment", buyerId: "PRAIRIE", subject: "Purchase order PF-7735",
    body: NORMAL_BODY, scenario: "straight_through",
    po: po("PRAIRIE", "PF-7735", "PF-DC1", "2026-10-17", "2026-10-31", [ln(1, "NB-4001", "Still Spring Water 500 mL x 24", "90", "CASE", "6.40"),
      ln(2, "NB-1003", "Fizz Classic Cola 330 mL x 24", "30", "CASE", "16.20")]) },
  { id: "ord-1016", minutesAgo: 71, fromName: "Sam Okafor", fromUser: "orders", buyerId: "LAKESHORE", subject: "New PO LF-20425",
    body: NORMAL_BODY, scenario: "straight_through",
    po: po("LAKESHORE", "LF-20425", "LF-DC1", "2026-10-17", "2026-10-31", [ln(1, "NB-4002", "Still Spring Water 1.5 L x 12", "56", "CASE", "7.90")]) },
  { id: "ord-1017", minutesAgo: 44, fromName: "Dana Ruiz", fromUser: "buying", buyerId: "SUMMIT", subject: "PO SG-55141",
    body: NORMAL_BODY, scenario: "straight_through",
    po: po("SUMMIT", "SG-55141", "SG-DC03", "2026-10-17", "2026-10-29", [ln(1, "NB-6001", "Iced Tea Peach 500 mL x 12", "24", "CASE", "11.25"),
      ln(2, "NB-1003", "Fizz Classic Cola 330 mL x 24", "36", "CASE", "16.20")]) },
  { id: "ord-1018", minutesAgo: 17, fromName: "Maya Chen", fromUser: "purchasing", buyerId: "HARBORVIEW", subject: "Purchase order HV-88231",
    body: NORMAL_BODY, scenario: "straight_through",
    po: po("HARBORVIEW", "HV-88231", "HV-DC2", "2026-10-17", "2026-10-30", [ln(1, "NB-4002", "Still Spring Water 1.5 L x 12", "40", "CASE", "7.90")]) },
];
