// Fictional reference data for the sample inbox (D71). Two separate sources on purpose:
// REFERENCE is what the order agent checks against (trading partners, catalogue, price lists, order history);
// ERP_MASTER is what the simulated downstream ERP holds. They can disagree, which is how a downstream
// rejection happens after the order passed the agent's own checks.

export const SUPPLIER = { id: "NWB", name: "Northwind Beverage Co.", mailbox: "orders@northwind-beverage.example" };

export type Location = { code: string; name: string; address: string };
export type Buyer = { id: string; name: string; domain: string; erpAccount: string; locations: Location[] };

export const BUYERS: Buyer[] = [
  { id: "HARBORVIEW", name: "Harborview Markets", domain: "harborview-markets.example", erpAccount: "40011", locations: [
    { code: "HV-DC1", name: "Columbus DC", address: "1200 Logistics Pkwy, Columbus, OH 43217" },
    { code: "HV-DC2", name: "Dayton DC", address: "88 Freight Rd, Dayton, OH 45414" },
  ] },
  { id: "SUMMIT", name: "Summit Grocers", domain: "summit-grocers.example", erpAccount: "40017", locations: [
    { code: "SG-DC03", name: "Fort Wayne DC", address: "310 Commerce Dr, Fort Wayne, IN 46825" },
    { code: "SG-DC14", name: "Indianapolis DC", address: "4500 W Raymond St, Indianapolis, IN 46241" },
  ] },
  { id: "LAKESHORE", name: "Lakeshore Foods", domain: "lakeshore-foods.example", erpAccount: "40023", locations: [
    { code: "LF-DC1", name: "Milwaukee DC", address: "77 Harbor Ave, Milwaukee, WI 53207" },
  ] },
  { id: "PRAIRIE", name: "Prairie Fresh Co-op", domain: "prairiefresh.example", erpAccount: "40031", locations: [
    { code: "PF-DC1", name: "Des Moines DC", address: "900 SE 30th St, Des Moines, IA 50317" },
    { code: "PF-DC2", name: "Omaha DC", address: "4120 S 60th St, Omaha, NE 68117" },
  ] },
];

export type Price = { unit: string; price: string; from: string; to: string | null };
export type Item = { sku: string; gtin: string; description: string; size: string; pack: string; units: string[];
  unitNote: string; prices: Price[] };

export const CATALOGUE: Item[] = [
  { sku: "NB-1001", gtin: "00614141300011", description: "Fizz Zero Cola 330 mL x 24", size: "330 mL can", pack: "24 per case",
    units: ["CASE"], unitNote: "Sold by the case", prices: [{ unit: "CASE", price: "16.80", from: "2026-01-01", to: null }] },
  { sku: "NB-1002", gtin: "00614141300028", description: "Fizz Zero Cola 500 mL x 24", size: "500 mL bottle", pack: "24 per case",
    units: ["CASE"], unitNote: "Sold by the case", prices: [{ unit: "CASE", price: "16.80", from: "2026-01-01", to: null }] },
  { sku: "NB-1003", gtin: "00614141300035", description: "Fizz Classic Cola 330 mL x 24", size: "330 mL can", pack: "24 per case",
    units: ["CASE"], unitNote: "Sold by the case", prices: [{ unit: "CASE", price: "16.20", from: "2026-01-01", to: null }] },
  { sku: "NB-2001", gtin: "00614141300042", description: "Sparkling Water Lemon 355 mL tray", size: "355 mL can", pack: "12-can tray",
    units: ["EA"], unitNote: "Sold by the tray (EA); no case unit", prices: [{ unit: "EA", price: "9.60", from: "2026-01-01", to: null }] },
  { sku: "NB-3001", gtin: "00614141300059", description: "Cold Brew Coffee 250 mL x 12", size: "250 mL bottle", pack: "12 per case",
    units: ["CASE"], unitNote: "Sold by the case", prices: [
      { unit: "CASE", price: "18.75", from: "2026-01-01", to: "2026-09-30" },
      { unit: "CASE", price: "18.50", from: "2026-10-01", to: null }] },
  { sku: "NB-4001", gtin: "00614141300066", description: "Still Spring Water 500 mL x 24", size: "500 mL bottle", pack: "24 per case",
    units: ["CASE"], unitNote: "Sold by the case", prices: [{ unit: "CASE", price: "6.40", from: "2026-01-01", to: null }] },
  { sku: "NB-4002", gtin: "00614141300073", description: "Still Spring Water 1.5 L x 12", size: "1.5 L bottle", pack: "12 per case",
    units: ["CASE"], unitNote: "Sold by the case", prices: [{ unit: "CASE", price: "7.90", from: "2026-01-01", to: null }] },
  { sku: "NB-5001", gtin: "00614141300080", description: "Ginger Ale 355 mL x 24", size: "355 mL can", pack: "24 per case",
    units: ["CASE"], unitNote: "Sold by the case", prices: [{ unit: "CASE", price: "14.10", from: "2026-01-01", to: null }] },
  { sku: "NB-6001", gtin: "00614141300097", description: "Iced Tea Peach 500 mL x 12", size: "500 mL bottle", pack: "12 per case",
    units: ["CASE"], unitNote: "Sold by the case", prices: [{ unit: "CASE", price: "11.25", from: "2026-01-01", to: null }] },
];

/** Recent orders per buyer and item: the unit used and the last order date. Evidence for recommendations. */
export const ORDER_HISTORY: { buyerId: string; sku: string; unit: string; orders: number; last: string }[] = [
  { buyerId: "SUMMIT", sku: "NB-2001", unit: "EA", orders: 6, last: "2026-09-29" },
  { buyerId: "HARBORVIEW", sku: "NB-1001", unit: "CASE", orders: 4, last: "2026-09-02" },
  { buyerId: "HARBORVIEW", sku: "NB-1002", unit: "CASE", orders: 3, last: "2026-09-16" },
  { buyerId: "LAKESHORE", sku: "NB-3001", unit: "CASE", orders: 5, last: "2026-09-24" },
];

/** The simulated downstream ERP's own customer master: active ship-to codes per account. */
export const ERP_MASTER: { account: string; shipTos: { code: string; address: string; active: boolean; note?: string }[] }[] = [
  { account: "40011", shipTos: [
    { code: "HV-DC1", address: "1200 Logistics Pkwy, Columbus, OH 43217", active: true },
    { code: "HV-DC2", address: "88 Freight Rd, Dayton, OH 45414", active: true }] },
  { account: "40017", shipTos: [
    { code: "SG-DC03", address: "310 Commerce Dr, Fort Wayne, IN 46825", active: true },
    { code: "SG-DC14", address: "4500 W Raymond St, Indianapolis, IN 46241", active: false, note: "Retired 2026-10-10" },
    { code: "SG-DC14N", address: "4500 W Raymond St, Indianapolis, IN 46241", active: true }] },
  { account: "40023", shipTos: [{ code: "LF-DC1", address: "77 Harbor Ave, Milwaukee, WI 53207", active: true }] },
  { account: "40031", shipTos: [
    { code: "PF-DC1", address: "900 SE 30th St, Des Moines, IA 50317", active: true },
    { code: "PF-DC2", address: "4120 S 60th St, Omaha, NE 68117", active: true }] },
];

export const PRICE_LIST_VERSION = "Price list 2026-10";
