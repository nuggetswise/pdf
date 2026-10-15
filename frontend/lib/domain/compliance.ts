// Retailer compliance checks for outbound EDIFACT (D47). Every generated ORDRSP, DESADV and INVOIC is parsed
// back from its own text and checked against the rules of the trading partner's profile before it may be
// sent. A rule that fails with severity "block" stops the send and the screen shows why.
//
// Every rule names its basis: "sourced" when a public document we could see states it, "inferred" when it
// follows from the standard or from arithmetic but we did not see it written down. docs/08-edi-mapping.md
// lists the same rules and sources. The independent syntax and structure check (ts-edifact against the
// UN/EDIFACT D.01B tables, pydifact for the interchange) runs in the tests, not here.
import { MESSAGE_VERSION } from "./edifact";
import { isGln, isGtin, isSscc } from "./gs1";
import { Dec, money } from "./money";

export type EdiKind = keyof typeof MESSAGE_VERSION;

// ---------- sources ----------

/** Public documents the rules cite. Seen through web search on 2026-10-15; see docs/08-edi-mapping.md. */
export const SOURCES = {
  gs1_desadv_s4: { title: "GS1 EANCOM 2002 S4 Part II, DESADV examples",
    url: "https://www.gs1.org/sites/gs1/files/docs/eancom/ean02s4/part2/desadv/examples.htm" },
  gs1de_desadv_unh: { title: "GS1 Germany eDESADV segment layout, UNH",
    url: "https://www.publikationen.gs1-germany.de/Complete/eEurope_english/desadv/english/all/h51.htm" },
  gs1de_desadv_examples: { title: "GS1 Germany EANCOM 2002 S3 DESADV examples (DTM+17, PCI+33E, GIN+BJ)",
    url: "https://www.publikationen.gs1-germany.de/Complete/ae_schuhe/english/messages/desadv/bsp3.htm" },
  sap_desadv_d01b: { title: "SAP Business Network EANCOM DESADV D01B guide (SSCC with PCI+33E)",
    url: "https://help.sap.com/doc/sap-business-network-eancom-desadv-d01b-inbound/cloud/en-US/SAP%20Business%20Network%20EANCOM%20DESADV%20D01B%20Inbound.pdf" },
  gs1at_pharma_desadv: { title: "GS1 Austria PHARMA DESADV EANCOM 2002 guideline",
    url: "https://www.gs1.at/sites/default/files/2020-05/PHARMA_DESADV_EANCOM_2002_1_3_EN.PDF" },
  gs1_ordrsp_s4: { title: "GS1 EANCOM 2002 S4 Part II, ORDRSP examples",
    url: "https://www.gs1.org/sites/gs1/files/docs/eancom/ean02s4/part2/ordrsp/examples.htm" },
  gs1_invoic_s3_moa: { title: "GS1 INVOIC (EAN011) S3 2002 Edition 2016, segment MOA",
    url: "https://edi.gs1si.org/eancom/ean02s3/part2/invoic/0515.htm" },
  gs1_invoic_s3: { title: "GS1 EANCOM 2002 S3 INVOIC message, Edition 2016",
    url: "https://www.gs1.org/sites/default/files/docs/eancom/s3/invoic.pdf" },
  gs1_invoic_s3_examples: { title: "GS1 EANCOM 2002 S3 INVOIC examples (two VAT rates)",
    url: "https://www.gs1.org/sites/default/files/docs/eancom/ean02s3/part2/invoic/examples.htm" },
  gs1de_invoic_media: { title: "GS1 Germany EDI recommendations v9.3, INVOIC (MOA+125 and MOA+124 even when zero)",
    url: "https://www.publikationen.gs1-germany.de/Complete/eancom_v9.3/profiles/ae/media/invoic/de/html/..%5C..%5Cen%5Cinvoic-ae-media-en.pdf" },
  sap_invoic_d01b: { title: "SAP Business Network EANCOM INVOIC D01B guide (TAX+7 and MOA+176)",
    url: "https://help.sap.com/doc/sap-business-network-eancom-invoic-d01b-inbound/cloud/en-US/SAP%20Business%20Network%20EANCOM%20INVOIC%20D01B%20Inbound.pdf" },
  gs1at_fashion_invoic: { title: "GS1 Austria FASHION INVOIC EANCOM 2002 (ALC+A with PCD+3)",
    url: "https://www.gs1.at/sites/default/files/2020-05/FASHION_INVOIC_Einzelrechnung_EANCOM_2002_1_1_EN.pdf" },
  mms_invoic: { title: "MediaMarktSaturn EDI guidelines, invoice for goods (INVOIC D.01B) 3.3",
    url: "https://edi.mediamarktsaturn.com/files/MMS_EDI-INVOIC-GUIDELINES_3.3.pdf" },
  mms_desadv: { title: "MediaMarktSaturn EDI guideline DESADV 2.5 (October 2025)",
    url: "https://edi.mediamarktsaturn.com/files/MMS_EDI_DESADV_GUIDELINE.pdf" },
  gs1_prefixes: { title: "GS1 prefix list (952 = demonstrations and examples)", url: "https://www.gs1.org/prefixes" },
} as const;
export type SourceId = keyof typeof SOURCES;

// ---------- profiles ----------

export const PROFILE_IDS = ["eancom2002", "mediamarktsaturn", "fictional_demo"] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];
export const PROFILES: Record<ProfileId, { name: string; summary: string }> = {
  eancom2002: { name: "EANCOM 2002 baseline (GS1)",
    summary: "GS1 EANCOM 2002 rules any retailer using EANCOM expects: GLNs, GTINs, SSCCs, dates, tax totals." },
  mediamarktsaturn: { name: "MediaMarktSaturn (public guides, partial)",
    summary: "The baseline plus the rules confirmed from MediaMarktSaturn's public INVOIC and DESADV guides. "
      + "Not every rule in those guides is implemented; see the mapping document." },
  fictional_demo: { name: "Fictional demo partner",
    summary: "The baseline, except that the demo catalogue's made-up item numbers are a warning instead of a block." },
};

// ---------- parsing our own output back ----------

export interface PSeg { tag: string; els: string[][] }

/** Split an interchange into segments, elements and components, honouring the release character "?". */
export function parseInterchange(text: string): PSeg[] {
  let body = text.replace(/\r?\n/g, "");
  if (body.startsWith("UNA")) body = body.slice(9);
  const segs: PSeg[] = [];
  let els: string[][] = [[""]];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    const comp = els[els.length - 1];
    if (ch === "?" && i + 1 < body.length) { comp[comp.length - 1] += body[++i]; continue; }
    if (ch === "'") {
      const [[tag], ...rest] = els;
      segs.push({ tag, els: rest });
      els = [[""]];
    } else if (ch === "+") els.push([""]);
    else if (ch === ":") comp.push("");
    else comp[comp.length - 1] += ch;
  }
  return segs;
}

const v = (s: PSeg | undefined, e: number, c = 0) => s?.els[e]?.[c] ?? "";
/** A segment or message count (never money): digits only, else -1. */
const count = (t: string) => (/^\d{1,9}$/.test(t) ? parseInt(t, 10) : -1);
const isDate102 = (d: string) => /^\d{8}$/.test(d) && !Number.isNaN(Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`));
const dec = (s: string): Dec | null => (/^-?\d+(\.\d+)?$/.test(s) ? Dec.of(s) : null);
const sum = (xs: (Dec | null)[]) => xs.reduce<Dec>((t, x) => (x ? t.add(x) : t), Dec.ZERO);
const NEG = Dec.of("-1");
const HUNDRED = Dec.of("100");
/** "19", "19.00" and "19.0" are the same rate: fixed point without trailing zeros. */
export const rateKey = (d: Dec) => { const f = d.toFixedPoint(); return f.includes(".") ? f.replace(/0+$/, "").replace(/\.$/, "") : f; };

/** Segments of one line item: from its LIN up to the next LIN, UNS or CNT. */
function lineGroups(segs: PSeg[]): PSeg[][] {
  const out: PSeg[][] = [];
  let cur: PSeg[] | null = null;
  for (const s of segs) {
    if (s.tag === "LIN") { cur = [s]; out.push(cur); continue; }
    if (["UNS", "CNT", "CPS", "UNT", "ALC"].includes(s.tag)) { cur = null; continue; }
    cur?.push(s);
  }
  return out;
}

/** The summary section of an INVOIC: everything after UNS. */
const summaryOf = (segs: PSeg[]) => segs.slice(segs.findIndex((s) => s.tag === "UNS") + 1);
const summaryMoa = (segs: PSeg[], q: string) => summaryOf(segs).find((s) => s.tag === "MOA" && v(s, 0) === q);

/** Allowance or charge blocks: ALC and the PCD / MOA / TAX that follow it, before the first LIN. */
function alcGroups(segs: PSeg[]): PSeg[][] {
  const out: PSeg[][] = [];
  let cur: PSeg[] | null = null;
  for (const s of segs) {
    if (s.tag === "LIN" || s.tag === "UNS") break;
    if (s.tag === "ALC") { cur = [s]; out.push(cur); continue; }
    cur?.push(s);
  }
  return out;
}

// ---------- rules ----------

export interface Rule {
  id: string;
  title: string;
  messages: EdiKind[];
  /** Profiles the rule applies to; absent means every profile. */
  profiles?: ProfileId[];
  basis: "sourced" | "inferred";
  sources: SourceId[];
  /** Plain-language failures; empty when the rule passes. */
  check: (segs: PSeg[], kind: EdiKind) => string[];
}

const ALL: EdiKind[] = ["ORDRSP", "DESADV", "INVOIC"];
const BGM_CODE: Record<EdiKind, string> = { ORDRSP: "231", DESADV: "351", INVOIC: "380" };

export const RULES: Rule[] = [
  {
    id: "SYNTAX-COUNTS", title: "Message and interchange counts and references match", messages: ALL,
    basis: "inferred", sources: [],
    check: (segs) => {
      const out: string[] = [];
      const from = segs.findIndex((s) => s.tag === "UNH");
      const to = segs.findIndex((s) => s.tag === "UNT");
      if (from < 0 || to < 0) return ["The message has no UNH header or UNT trailer."];
      if (count(v(segs[to], 0)) !== to - from + 1) out.push(`UNT says ${v(segs[to], 0)} segments, the message has ${to - from + 1}.`);
      if (v(segs[to], 1) !== v(segs[from], 0)) out.push("UNT does not repeat the UNH message reference.");
      const unb = segs.find((s) => s.tag === "UNB");
      const unz = segs.find((s) => s.tag === "UNZ");
      if (!unb || !unz) out.push("The interchange has no UNB header or UNZ trailer.");
      else {
        if (v(unz, 0) !== String(segs.filter((s) => s.tag === "UNH").length)) out.push("UNZ message count is wrong.");
        if (v(unz, 1) !== v(unb, 4)) out.push("UNZ does not repeat the UNB interchange reference.");
      }
      return out;
    },
  },
  {
    id: "HEADER-VERSION", title: "UNH names the EANCOM 2002 message version", messages: ALL,
    basis: "sourced", sources: ["gs1_desadv_s4", "gs1de_desadv_unh", "gs1_ordrsp_s4", "gs1_invoic_s3_moa", "mms_desadv"],
    check: (segs, kind) => {
      const unh = segs.find((s) => s.tag === "UNH");
      const got = unh?.els[1]?.join(":") ?? "";
      return got === MESSAGE_VERSION[kind] ? [] : [`UNH says ${got || "nothing"}; expected ${MESSAGE_VERSION[kind]}.`];
    },
  },
  {
    id: "INTERCHANGE-GLN", title: "Interchange sender and recipient are GLNs", messages: ALL,
    basis: "inferred", sources: [],
    check: (segs) => {
      const unb = segs.find((s) => s.tag === "UNB");
      const out: string[] = [];
      for (const [e, who] of [[1, "sender"], [2, "recipient"]] as const) {
        if (!isGln(v(unb, e)) || v(unb, e, 1) !== "14") {
          out.push(`Interchange ${who} "${v(unb, e) || "missing"}" is not a valid GLN (qualifier 14).`);
        }
      }
      return out;
    },
  },
  {
    id: "BGM", title: "Document type and number", messages: ALL, basis: "inferred", sources: [],
    check: (segs, kind) => {
      const bgm = segs.find((s) => s.tag === "BGM");
      if (!bgm) return ["The message has no BGM segment."];
      const out: string[] = [];
      if (v(bgm, 0) !== BGM_CODE[kind]) out.push(`BGM document code is ${v(bgm, 0)}; ${kind} uses ${BGM_CODE[kind]}.`);
      if (!v(bgm, 1)) out.push("BGM has no document number.");
      return out;
    },
  },
  {
    id: "DOCUMENT-DATE", title: "Document date (DTM+137) in CCYYMMDD", messages: ALL, basis: "inferred", sources: [],
    check: (segs) => {
      const d = segs.find((s) => s.tag === "DTM" && v(s, 0) === "137");
      return d && isDate102(v(d, 0, 1)) && v(d, 0, 2) === "102" ? [] : ["Document date DTM+137 is missing or not a valid date."];
    },
  },
  {
    id: "ORDER-REFERENCE", title: "Buyer's order number (RFF+ON)", messages: ALL,
    basis: "sourced", sources: ["gs1_desadv_s4"],
    check: (segs) => {
      const r = segs.find((s) => s.tag === "RFF" && v(s, 0) === "ON");
      return r && v(r, 0, 1) ? [] : ["The purchase order number (RFF+ON) is missing. The PO PDF did not give one."];
    },
  },
  {
    id: "PARTY-GLN", title: "Buyer, supplier and delivery party identified by GLN", messages: ALL,
    basis: "sourced", sources: ["gs1_desadv_s4"],
    check: (segs) => {
      const out: string[] = [];
      const label = { BY: "Buyer", SU: "Supplier", DP: "Delivery party (ship-to)" } as const;
      for (const q of ["BY", "SU", "DP"] as const) {
        const n = segs.find((s) => s.tag === "NAD" && v(s, 0) === q);
        if (!n) out.push(`${label[q]} (NAD+${q}) is missing.`);
        else if (!isGln(v(n, 1))) out.push(`${label[q]} has no valid GLN ("${v(n, 1) || "empty"}"). Add it in the trading partner setup.`);
        else if (v(n, 1, 2) !== "9") out.push(`${label[q]} GLN must use code list 9 (GS1).`);
      }
      return out;
    },
  },
  {
    id: "ITEM-GTIN", title: "Every line identifies the item by a valid GTIN", messages: ALL,
    basis: "inferred", sources: [],
    check: (segs) => lineGroups(segs).flatMap(([lin]) => {
      const gtin = v(lin, 2);
      if (!gtin) return [`Line ${v(lin, 0)} has no GTIN.`];
      if (v(lin, 2, 1) !== "SRV") return [`Line ${v(lin, 0)}: item number type must be SRV (GTIN).`];
      return isGtin(gtin) ? [] : [`Line ${v(lin, 0)}: "${gtin}" is not a valid GTIN (8, 12, 13 or 14 digits with a correct check digit).`];
    }),
  },
  {
    id: "DESADV-DATES", title: "Despatch date (DTM+11) and estimated delivery date (DTM+17)", messages: ["DESADV"],
    basis: "sourced", sources: ["gs1de_desadv_examples"],
    check: (segs) => {
      const d = (q: string) => v(segs.find((s) => s.tag === "DTM" && v(s, 0) === q), 0, 1);
      const out: string[] = [];
      if (!isDate102(d("11"))) out.push("Despatch date (DTM+11) is missing or not a date.");
      if (!isDate102(d("17"))) out.push("Estimated delivery date (DTM+17) is missing. Enter when the goods will arrive.");
      else if (isDate102(d("11")) && d("17") < d("11")) out.push("Estimated delivery date is before the despatch date.");
      return out;
    },
  },
  {
    id: "DESADV-SSCC", title: "Every pallet and carton carries a valid SSCC (PCI+33E, GIN+BJ)", messages: ["DESADV"],
    basis: "sourced", sources: ["sap_desadv_d01b", "gs1at_pharma_desadv", "gs1_desadv_s4"],
    check: (segs) => {
      const out: string[] = [];
      const seen = new Set<string>();
      segs.forEach((s, i) => {
        if (s.tag !== "CPS" || v(s, 0) === "1") return;
        const until = segs.findIndex((x, j) => j > i && (x.tag === "CPS" || x.tag === "LIN" || x.tag === "CNT"));
        const block = segs.slice(i + 1, until < 0 ? undefined : until);
        const pci = block.find((x) => x.tag === "PCI");
        const gin = block.find((x) => x.tag === "GIN" && v(x, 0) === "BJ");
        if (!block.some((x) => x.tag === "PAC")) out.push(`Package level ${v(s, 0)} has no PAC segment.`);
        if (v(pci, 0) !== "33E" || !gin) { out.push(`Package level ${v(s, 0)} has no SSCC (PCI+33E then GIN+BJ).`); return; }
        const code = v(gin, 1);
        if (!isSscc(code)) out.push(`Package level ${v(s, 0)}: "${code}" is not a valid 18-digit SSCC.`);
        if (seen.has(code)) out.push(`SSCC ${code} is used twice.`);
        seen.add(code);
      });
      return out;
    },
  },
  {
    id: "DESADV-HIERARCHY", title: "Packing hierarchy is complete and every line ships a quantity", messages: ["DESADV"],
    basis: "inferred", sources: [],
    check: (segs) => {
      const out: string[] = [];
      const levels = new Set<string>();
      let current = "";
      for (const s of segs) {
        if (s.tag === "CPS") {
          const [lvl, parent] = [v(s, 0), v(s, 1)];
          if (levels.size === 0 && lvl !== "1") out.push("The hierarchy must start at CPS+1 (the consignment).");
          if (levels.size > 0 && !levels.has(parent)) out.push(`Level ${lvl} names parent ${parent || "none"}, which comes nowhere before it.`);
          if (levels.has(lvl)) out.push(`Hierarchy level ${lvl} is used twice.`);
          levels.add(lvl);
          current = lvl;
        }
        if (s.tag === "LIN" && current === "1") out.push(`Line ${v(s, 0)} is not packed in a pallet or carton.`);
      }
      for (const g of lineGroups(segs)) {
        const q = g.find((x) => x.tag === "QTY" && v(x, 0) === "12");
        const n = dec(v(q, 0, 1));
        if (!n || !Dec.ZERO.lt(n)) out.push(`Line ${v(g[0], 0)} has no despatched quantity above zero (QTY+12).`);
      }
      const cnt = segs.find((s) => s.tag === "CNT" && v(s, 0) === "2");
      const lins = segs.filter((s) => s.tag === "LIN").length;
      if (lins === 0) out.push("Nothing is despatched.");
      if (count(v(cnt, 0, 1)) !== lins) out.push(`CNT+2 says ${v(cnt, 0, 1) || "nothing"}; the message has ${lins} lines.`);
      return out;
    },
  },
  {
    id: "INVOICE-HEADER", title: "Currency (CUX) and despatch advice reference (RFF+AAK)", messages: ["INVOIC"],
    basis: "inferred", sources: [],
    check: (segs) => {
      const out: string[] = [];
      const cux = segs.find((s) => s.tag === "CUX");
      if (!cux || v(cux, 0) !== "2" || !/^[A-Z]{3}$/.test(v(cux, 0, 1)) || v(cux, 0, 2) !== "4") {
        out.push("Invoice currency (CUX+2:<ISO code>:4) is missing or not a 3-letter code.");
      }
      if (!segs.some((s) => s.tag === "RFF" && v(s, 0) === "AAK" && v(s, 0, 1))) out.push("The ASN reference (RFF+AAK) is missing.");
      return out;
    },
  },
  {
    id: "INVOICE-LINES", title: "Every line has quantity, price, amount and tax rate, and the amount is quantity times price",
    messages: ["INVOIC"], basis: "sourced", sources: ["gs1_invoic_s3_examples"],
    check: (segs) => lineGroups(segs).flatMap((g) => {
      const n = v(g[0], 0);
      const q = dec(v(g.find((x) => x.tag === "QTY" && v(x, 0) === "47"), 0, 1));
      const amt = dec(v(g.find((x) => x.tag === "MOA" && v(x, 0) === "203"), 0, 1));
      const pri = dec(v(g.find((x) => x.tag === "PRI" && v(x, 0) === "AAA"), 0, 1));
      const tax = g.find((x) => x.tag === "TAX" && v(x, 0) === "7");
      const out: string[] = [];
      if (!q || !amt || !pri) out.push(`Line ${n} needs QTY+47, MOA+203 and PRI+AAA.`);
      else if (money(q.mul(pri)) !== money(amt)) out.push(`Line ${n}: ${q} x ${pri} is ${money(q.mul(pri))}, not ${amt}.`);
      if (!tax || !dec(v(tax, 4, 3))) out.push(`Line ${n} has no tax rate (TAX+7).`);
      return out;
    }),
  },
  {
    id: "INVOICE-ALLOWANCES", title: "Allowances and charges carry an amount and tax rate, and percentages add up",
    messages: ["INVOIC"], basis: "sourced", sources: ["gs1at_fashion_invoic"],
    check: (segs) => {
      const base = lineBaseByRate(segs);
      return alcGroups(segs).flatMap((g) => {
        const isA = v(g[0], 0) === "A";
        const what = `${isA ? "Allowance" : "Charge"} ${v(g[0], 4) || "(no code)"}`;
        const amt = dec(v(g.find((x) => x.tag === "MOA" && v(x, 0) === (isA ? "204" : "23")), 0, 1));
        const rate = v(g.find((x) => x.tag === "TAX"), 4, 3);
        const pcd = g.find((x) => x.tag === "PCD");
        const out: string[] = [];
        if (!v(g[0], 4)) out.push(`${what} has no reason code.`);
        if (!amt) out.push(`${what} has no amount (MOA+${isA ? "204" : "23"}).`);
        if (!dec(rate)) out.push(`${what} has no tax rate.`);
        if (pcd && amt && dec(rate)) {
          const pct = dec(v(pcd, 0, 1));
          const expected = pct ? money((base.get(rateKey(Dec.of(rate))) ?? Dec.ZERO).mul(pct).div(HUNDRED)) : null;
          if (expected !== money(amt)) out.push(`${what}: ${v(pcd, 0, 1)}% of the lines at ${rate}% is ${expected}, not ${amt}.`);
        }
        return out;
      });
    },
  },
  {
    id: "INVOICE-TOTALS",
    title: "Invoice totals present and reconcile: lines, taxable amount, tax per rate, invoice amount",
    messages: ["INVOIC"], basis: "sourced",
    sources: ["gs1_invoic_s3", "gs1de_invoic_media", "sap_invoic_d01b", "mms_invoic"],
    check: (segs) => {
      const out: string[] = [];
      const get = (q: string) => dec(v(summaryMoa(segs, q), 0, 1));
      const [m77, m79, m125, m176] = [get("77"), get("79"), get("125"), get("176")];
      if (!m77 || !m79 || !m125 || !m176) {
        return ["The summary needs MOA+77 (invoice amount), MOA+79 (line total), MOA+125 (taxable amount) and MOA+176 (tax)."];
      }
      const lines = sum(lineGroups(segs).map((g) => dec(v(g.find((x) => x.tag === "MOA" && v(x, 0) === "203"), 0, 1))));
      if (!lines.eq(m79)) out.push(`MOA+79 is ${m79}; the lines add up to ${money(lines)}.`);
      const alc = alcGroups(segs).map((g) => {
        const isA = v(g[0], 0) === "A";
        const a = dec(v(g.find((x) => x.tag === "MOA" && v(x, 0) === (isA ? "204" : "23")), 0, 1)) ?? Dec.ZERO;
        return isA ? a.mul(NEG) : a;
      });
      const taxable = m79.add(sum(alc));
      if (!taxable.eq(m125)) out.push(`MOA+125 is ${m125}; lines less allowances plus charges is ${money(taxable)}.`);
      // Tax subtotals per rate: TAX+7 in the summary followed by MOA+124 and MOA+125.
      const summary = summaryOf(segs);
      const rates = summary.flatMap((s, i) => (s.tag === "TAX" ? [{ rate: v(s, 4, 3),
        tax: dec(v(summary.slice(i + 1, i + 3).find((x) => v(x, 0) === "124"), 0, 1)),
        base: dec(v(summary.slice(i + 1, i + 3).find((x) => v(x, 0) === "125"), 0, 1)) }] : []));
      if (rates.length === 0 || rates.some((r) => !r.tax || !r.base)) {
        out.push("Each tax rate needs a summary TAX+7 with MOA+124 (tax) and MOA+125 (taxable amount), even when zero.");
        return out;
      }
      const expectBase = taxableByRate(segs);
      for (const [rate, b] of expectBase) {
        const r = rates.find((x) => dec(x.rate) && rateKey(Dec.of(x.rate)) === rate);
        if (!r) { out.push(`No tax subtotal for the ${rate}% rate used on the invoice.`); continue; }
        if (!r.base!.eq(b)) out.push(`Taxable at ${rate}% is ${r.base}; the lines and allowances give ${money(b)}.`);
        const t = money(b.mul(Dec.of(rate)).div(HUNDRED));
        if (money(r.tax!) !== t) out.push(`Tax at ${rate}% is ${r.tax}; ${money(b)} x ${rate}% is ${t}.`);
      }
      if (!sum(rates.map((r) => r.tax)).eq(m176)) out.push(`MOA+176 is ${m176}; the tax subtotals add up to ${money(sum(rates.map((r) => r.tax)))}.`);
      if (!sum(rates.map((r) => r.base)).eq(m125)) out.push("The taxable subtotals do not add up to MOA+125.");
      if (!m125.add(m176).eq(m77)) out.push(`MOA+77 is ${m77}; taxable amount plus tax is ${money(m125.add(m176))}.`);
      return out;
    },
  },
  {
    id: "MMS-VAT-IDS", title: "Buyer and supplier carry their VAT registration number (RFF+VA)", messages: ["INVOIC"],
    profiles: ["mediamarktsaturn"], basis: "sourced", sources: ["mms_invoic"],
    check: (segs) => (["BY", "SU"] as const).flatMap((q) => {
      const i = segs.findIndex((s) => s.tag === "NAD" && v(s, 0) === q);
      const next = segs[i + 1];
      return i >= 0 && next?.tag === "RFF" && v(next, 0) === "VA" && v(next, 0, 1) ? []
        : [`${q === "BY" ? "Buyer" : "Supplier"} VAT registration number (RFF+VA) is missing. Add it in the trading partner setup.`];
    }),
  },
  {
    id: "MMS-CONTRACT", title: "EDI agreement reference (RFF+CT)", messages: ["INVOIC"],
    profiles: ["mediamarktsaturn"], basis: "sourced", sources: ["mms_invoic"],
    check: (segs) => (segs.some((s) => s.tag === "RFF" && v(s, 0) === "CT" && v(s, 0, 1)) ? []
      : ["The EDI agreement reference (RFF+CT) is missing. The retailer refuses EDI invoices without one."]),
  },
];

/** Line amounts per tax rate (rate normalised, e.g. "19", "7.5"). */
function lineBaseByRate(segs: PSeg[]): Map<string, Dec> {
  const m = new Map<string, Dec>();
  for (const g of lineGroups(segs)) {
    const rate = dec(v(g.find((x) => x.tag === "TAX"), 4, 3));
    const amt = dec(v(g.find((x) => x.tag === "MOA" && v(x, 0) === "203"), 0, 1));
    if (!rate || !amt) continue;
    const k = rateKey(rate);
    m.set(k, (m.get(k) ?? Dec.ZERO).add(amt));
  }
  return m;
}

/** Lines per rate less allowances plus charges at that rate. */
function taxableByRate(segs: PSeg[]): Map<string, Dec> {
  const m = lineBaseByRate(segs);
  for (const g of alcGroups(segs)) {
    const isA = v(g[0], 0) === "A";
    const rate = dec(v(g.find((x) => x.tag === "TAX"), 4, 3));
    const amt = dec(v(g.find((x) => x.tag === "MOA"), 0, 1));
    if (!rate || !amt) continue;
    const k = rateKey(rate);
    m.set(k, (m.get(k) ?? Dec.ZERO).add(isA ? amt.mul(NEG) : amt));
  }
  return m;
}

// ---------- running the checks ----------

export interface Finding {
  ruleId: string; severity: "block" | "warn"; text: string; basis: Rule["basis"]; sources: SourceId[];
}
export interface ComplianceResult {
  profile: ProfileId; kind: EdiKind; rulesChecked: number; rulesPassed: number; findings: Finding[];
}

/** Rules that a fictional-demo partner reports as a warning: the demo catalogue's item numbers are made up. */
const RELAXED: Partial<Record<ProfileId, string[]>> = { fictional_demo: ["ITEM-GTIN"] };

export const rulesFor = (kind: EdiKind, profile: ProfileId) =>
  RULES.filter((r) => r.messages.includes(kind) && (!r.profiles || r.profiles.includes(profile)));

export function checkMessage(kind: EdiKind, text: string, profile: ProfileId): ComplianceResult {
  const segs = parseInterchange(text);
  const rules = rulesFor(kind, profile);
  const findings: Finding[] = [];
  let passed = 0;
  for (const r of rules) {
    const fails = r.check(segs, kind);
    if (fails.length === 0) { passed += 1; continue; }
    const severity: Finding["severity"] = RELAXED[profile]?.includes(r.id) ? "warn" : "block";
    findings.push(...fails.map((text) => ({ ruleId: r.id, severity, text, basis: r.basis, sources: r.sources })));
  }
  return { profile, kind, rulesChecked: rules.length, rulesPassed: passed, findings };
}

export const blocking = (r: ComplianceResult) => r.findings.filter((f) => f.severity === "block");

/** One sentence for a refusal: "The retailer would reject this DESADV: a; b." */
export const refusal = (r: ComplianceResult) =>
  `The retailer would reject this ${r.kind} (${PROFILES[r.profile].name}): ${blocking(r).map((f) => f.text).join(" ")}`;
