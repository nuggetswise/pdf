// Trading partner EDI setup (D47): the supplier's own GLN, VAT number and GS1 company prefix, and per retailer
// the compliance profile, buyer GLN, VAT number, contract reference and a GLN for each ship-to.
// Nothing here is guessed for a real retailer: a customer added from a real PO starts with empty GLNs, so
// its EDI is blocked until a reviewer types them in. Only the fictional demo customers get fictional
// GLNs (GS1 demo prefix 952), labelled as such.
import bundledReference from "./reference-data.v1.json";
import { type ProfileId, PROFILE_IDS } from "./compliance";
import { DEMO_COMPANY_PREFIX, FICTIONAL_GLN, fictionalGln, isCompanyPrefix, isGln } from "./gs1";
import { Dec } from "./money";
import {
  type RunState, type SupplierSetup, type TradingPartner, decimalString, emptyPortal,
} from "./run-state";
import { Conflict, type Clock, Forbidden, type Who, systemClock } from "./workflow";

interface RefCustomer { customer_id: string; name: string; ship_tos: { ship_to_id: string }[]; ship_to_not_on_file?: boolean }
const baseCustomers = (s: RunState): { fictional: boolean; customers: RefCustomer[] } => {
  const ref = (s.settings.referenceData ?? bundledReference) as unknown as { fictional?: boolean; customers: RefCustomer[] };
  return { fictional: ref.fictional === true, customers: ref.customers };
};

/** The labelled fictional supplier used until a reviewer enters the real one. */
export const FICTIONAL_SUPPLIER: Omit<SupplierSetup, "updatedBy" | "updatedAt"> = {
  name: "Northern Foods Manufacturing Inc.", gln: FICTIONAL_GLN.supplier, vatId: null, companyPrefix: DEMO_COMPANY_PREFIX,
  taxType: "SALES", defaultTaxRate: "0", paymentTerms: { discountPercent: "2", discountDays: 10, netDays: 30 },
};

/** "2% 10, net 30" or "Net 30". */
export function termsText(t: { discountPercent?: string | null; discountDays?: number | null; netDays: number } | undefined): string {
  if (!t) return "none";
  return t.discountPercent && t.discountDays != null ? `${t.discountPercent}% ${t.discountDays}, net ${t.netDays}` : `Net ${t.netDays}`;
}

export function supplierSetup(s: RunState): Omit<SupplierSetup, "updatedBy" | "updatedAt"> & { fictional: boolean } {
  const stored = s.portal?.supplier;
  return stored ? { ...stored, fictional: false } : { ...FICTIONAL_SUPPLIER, fictional: true };
}

/** A customer from the bundled (fictional) reference data, not one added from a real PO in this session. */
export function isFictionalCustomer(s: RunState, customerId: string | null): boolean {
  const { fictional, customers } = baseCustomers(s);
  return fictional && customers.some((c) => c.customer_id === customerId);
}

export type EffectivePartner = Omit<TradingPartner, "updatedBy" | "updatedAt"> & { isDefault: boolean; fictional: boolean };

export function partnerFor(s: RunState, customerId: string | null): EffectivePartner {
  const stored = s.portal?.partners?.find((p) => p.customerId === customerId);
  const fictional = isFictionalCustomer(s, customerId);
  if (stored) return { ...stored, isDefault: false, fictional };
  if (fictional) {
    const { customers } = baseCustomers(s);
    const i = customers.findIndex((c) => c.customer_id === customerId);
    let n = 0;
    const shipToGlns = customers.flatMap((c, ci) => c.ship_tos.map((t) => ({ ci, shipToId: t.ship_to_id, gln: fictionalGln("ship_to", ++n) })))
      .filter((x) => x.ci === i).map(({ shipToId, gln }) => ({ shipToId, gln }));
    // A fictional retailer whose POs print a ship-to address but no code (the example PO) gets one delivery GLN.
    if (!shipToGlns.length && customers[i]?.ship_to_not_on_file) shipToGlns.push({ shipToId: "(no ship-to on the PO)", gln: fictionalGln("ship_to", 90 + i) });
    return { customerId: customerId ?? "", profile: "x12_retail", buyerGln: fictionalGln("buyer", i + 1), buyerVatId: null,
      contractRef: null, vendorNumber: null, shipToGlns, isDefault: true, fictional };
  }
  return { customerId: customerId ?? "", profile: "x12_retail", buyerGln: null, buyerVatId: null, contractRef: null, vendorNumber: null,
    shipToGlns: [], isDefault: true, fictional };
}

// ---------- edits (reviewer or administrator) ----------

const REVIEWERS = new Set(["reviewer", "administrator"]);
const nextId = (rows: { id: number }[]) => rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
const clean = (v: string | null | undefined, max: number, what: string): string | null => {
  const t = (v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (t.length > max) throw new Conflict(`${what} is longer than ${max} characters`);
  return t || null;
};
const glnOrNull = (v: string | null | undefined, what: string): string | null => {
  const t = (v ?? "").replace(/\s/g, "");
  if (!t) return null;
  if (!isGln(t)) throw new Conflict(`${what} "${t}" is not a valid GLN: 13 digits with a correct GS1 check digit`);
  return t;
};

export interface SupplierInput {
  name?: string | null; gln: string; vatId?: string | null; companyPrefix: string; taxType: "VAT" | "GST" | "SALES";
  defaultTaxRate?: string | null;
  paymentTerms?: { discountPercent?: string | null; discountDays?: number | null; netDays: number } | null;
}

export function saveSupplierSetup(state: RunState, input: SupplierInput, who: Who, clock: Clock = systemClock): RunState {
  if (!REVIEWERS.has(who.role)) throw new Forbidden("Reviewer or administrator role required");
  const gln = glnOrNull(input.gln, "Supplier GLN");
  if (!gln) throw new Conflict("Supplier GLN is required");
  const prefix = (input.companyPrefix ?? "").trim();
  if (!isCompanyPrefix(prefix)) throw new Conflict("GS1 company prefix must be 6 to 12 digits");
  const rate = clean(input.defaultTaxRate, 10, "Default tax rate");
  if (rate !== null && !validRate(rate)) throw new Conflict("Default tax rate must be a number from 0 to 100");
  const t = input.paymentTerms;
  const disc = t ? clean(t.discountPercent, 10, "Early payment discount") : null;
  if (disc !== null && !validRate(disc)) throw new Conflict("Early payment discount must be a number from 0 to 100");
  if (t && (!Number.isInteger(t.netDays) || t.netDays < 0 || t.netDays > 365)) throw new Conflict("Net days must be a whole number from 0 to 365");
  if (t && disc !== null && (t.discountDays == null || !Number.isInteger(t.discountDays) || t.discountDays < 0 || t.discountDays > t.netDays)) {
    throw new Conflict("Discount days must be a whole number no larger than the net days");
  }
  const s = structuredClone(state);
  s.portal ??= emptyPortal();
  const now = clock.now();
  s.portal.supplier = { name: clean(input.name, 70, "Supplier name"), gln, vatId: clean(input.vatId, 35, "Supplier VAT number"),
    companyPrefix: prefix, taxType: input.taxType, defaultTaxRate: rate,
    ...(t ? { paymentTerms: { discountPercent: disc, discountDays: disc !== null ? t.discountDays ?? null : null, netDays: t.netDays } } : {}),
    updatedBy: who.actor, updatedAt: now };
  s.audit.push({ id: nextId(s.audit), entityType: "system", entityId: 0, event: "supplier_edi_setup_saved", actor: who.actor,
    detail: { gln, company_prefix: prefix }, createdAt: now });
  return s;
}

export interface PartnerInput {
  customerId: string; profile: ProfileId; buyerGln?: string | null; buyerVatId?: string | null; contractRef?: string | null; vendorNumber?: string | null;
  shipToGlns: { shipToId: string; gln: string }[];
}

export function saveTradingPartner(state: RunState, input: PartnerInput, who: Who, clock: Clock = systemClock): RunState {
  if (!REVIEWERS.has(who.role)) throw new Forbidden("Reviewer or administrator role required");
  if (!PROFILE_IDS.includes(input.profile)) throw new Conflict("Unknown compliance profile");
  const customerId = clean(input.customerId, 100, "Customer ID");
  if (!customerId) throw new Conflict("Customer ID is required");
  const shipToGlns = input.shipToGlns.flatMap((t) => {
    const gln = glnOrNull(t.gln, `GLN for ship-to ${t.shipToId}`);
    const shipToId = clean(t.shipToId, 100, "Ship-to ID");
    return gln && shipToId ? [{ shipToId, gln }] : [];
  });
  const s = structuredClone(state);
  s.portal ??= emptyPortal();
  const now = clock.now();
  const row: TradingPartner = { customerId, profile: input.profile, buyerGln: glnOrNull(input.buyerGln, "Buyer GLN"),
    buyerVatId: clean(input.buyerVatId, 35, "Buyer VAT number"), contractRef: clean(input.contractRef, 35, "Contract reference"),
    vendorNumber: clean(input.vendorNumber, 30, "Vendor number"),
    shipToGlns, updatedBy: who.actor, updatedAt: now };
  s.portal.partners = [...(s.portal.partners ?? []).filter((p) => p.customerId !== customerId), row];
  s.audit.push({ id: nextId(s.audit), entityType: "system", entityId: 0, event: "trading_partner_saved", actor: who.actor,
    detail: { customer_id: customerId, profile: input.profile }, createdAt: now });
  return s;
}

export function validRate(v: string): boolean {
  if (!decimalString.safeParse(v).success || v.startsWith("-")) return false;
  return !Dec.of("100").lt(Dec.of(v));
}
