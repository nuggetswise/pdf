// D47 independent check: the EDIFACT this portal generates is parsed by a third-party library against the
// UN/EDIFACT D.01B message tables, not by our own code. ts-edifact 0.0.14 ships the D.01B DESADV and INVOIC
// structure, segment and element tables (generated from UNECE); it fails on a missing mandatory segment,
// a segment out of place, an unknown segment or an element that breaks its format or length.
// The same samples are written to fixtures/edi-samples/ and checked again by pydifact (Python) in
// scripts/edi_syntax_check.py. Regenerate them with: UPDATE_EDI_SAMPLES=1 npx vitest run edifact-independent
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { InterchangeBuilder, Reader } from "ts-edifact";
import { REVIEWER } from "./__fixtures__/demo";
import { ASN, sessionOrder, setUp } from "./__fixtures__/retailer";
import { replayGuidedDemo } from "./__fixtures__/replay";
import { blocking, checkMessage } from "./compliance";
import { portalForOrder, retryOutbound, submitAsn, submitInvoice } from "./portal";

const SPEC = join(dirname(createRequire(import.meta.url).resolve("ts-edifact")), "messageSpec") + "/";
const SAMPLES = join(__dirname, "../../../fixtures/edi-samples");
const clock = { now: () => "2026-10-15T09:30:00.000Z" };

/** Parse with ts-edifact and build the message tree against the D.01B tables. Throws on any violation. */
function independentCheck(text: string) {
  const quiet = console.log;
  console.log = () => {}; // ts-edifact logs which table file it falls back to
  try {
    const reader = new Reader(SPEC);
    const segments = reader.parse(text.replace(/\n/g, ""));
    const built = new InterchangeBuilder(segments, reader.separators, SPEC);
    return { segments: segments.length, messages: built.interchange.messages.length };
  } finally {
    console.log = quiet;
  }
}

function samples(): Record<string, { kind: "ORDRSP" | "DESADV" | "INVOIC"; text: string }> {
  // Fictional demo partner: the replayed demo order 1, shipped short on two pallets.
  let demo = submitAsn(replayGuidedDemo(), 1, { lines: [{ lineIndex: 0, shippedQty: "4" }, { lineIndex: 1, shippedQty: "2" },
    { lineIndex: 2, shippedQty: "1" }], estimatedDelivery: "2026-10-20", packing: { cartonsPerPallet: 2 } }, REVIEWER, clock);
  demo = submitInvoice(demo, portalForOrder(demo, 1).asn!.id, { lines: [{ lineIndex: 0, quantity: "4" },
    { lineIndex: 1, quantity: "2" }, { lineIndex: 2, quantity: "1" }] }, REVIEWER, clock);
  const dp = portalForOrder(demo, 1);
  // A retailer onboarded from its PO, on the MediaMarktSaturn profile: cartons, two tax rates, a discount and freight.
  const { s: s0, docId } = sessionOrder();
  let r = setUp(s0, docId, "mediamarktsaturn", { buyerVatId: "DE999999999", contractRef: "EDI-AGR-DEMO-1" });
  r = retryOutbound(r, portalForOrder(r, docId).confirmation!.id, REVIEWER, clock); // held until the GLNs existed
  r = submitAsn(r, docId, { ...ASN, packing: { cartonsPerPallet: 2, unitsPerCarton: [{ lineIndex: 0, units: "5" }] } }, REVIEWER, clock);
  r = submitInvoice(r, portalForOrder(r, docId).asn!.id, { lines: [{ lineIndex: 0, quantity: "12", taxRate: "19" },
    { lineIndex: 1, quantity: "5", taxRate: "7" }], allowances: [{ kind: "allowance", code: "DI", percent: "2", taxRate: "19" },
    { kind: "charge", code: "FC", amount: "15.00", taxRate: "19" }] }, REVIEWER, clock);
  const rp = portalForOrder(r, docId);
  const body = (m: { kind: string; body: string }[], k: string) => m.find((x) => x.kind === k)!.body;
  return {
    "demo-ORDRSP": { kind: "ORDRSP", text: dp.confirmation!.body },
    "demo-DESADV": { kind: "DESADV", text: body(dp.asnMessages, "DESADV") },
    "demo-INVOIC": { kind: "INVOIC", text: body(dp.invoiceMessages, "INVOIC") },
    "retailer-ORDRSP": { kind: "ORDRSP", text: rp.confirmation!.body },
    "retailer-DESADV": { kind: "DESADV", text: body(rp.asnMessages, "DESADV") },
    "retailer-INVOIC": { kind: "INVOIC", text: body(rp.invoiceMessages, "INVOIC") },
  };
}

describe("generated EDIFACT passes an independent D.01B check", () => {
  const all = samples();
  for (const [name, { kind, text }] of Object.entries(all)) {
    // ts-edifact ships no ORDRSP table, so it cannot check an ORDRSP; pydifact checks its syntax and counts.
    if (kind !== "ORDRSP") {
      it(`${name}: ts-edifact builds it against the D.01B ${kind} tables`, () => {
        expect(independentCheck(text).messages).toBe(1);
      });
    }
    it(`${name}: committed sample in fixtures/edi-samples is current`, () => {
      const file = join(SAMPLES, `${name}.edi`);
      if (process.env.UPDATE_EDI_SAMPLES === "1") writeFileSync(file, text);
      expect(existsSync(file) ? readFileSync(file, "utf8") : "(missing; run with UPDATE_EDI_SAMPLES=1)").toBe(text);
    });
  }
  it("the retailer samples pass every blocking retailer rule", () => {
    for (const k of ["retailer-ORDRSP", "retailer-DESADV", "retailer-INVOIC"] as const) {
      expect(blocking(checkMessage(all[k].kind, all[k].text, "mediamarktsaturn"))).toEqual([]);
    }
  });
});

describe("the independent check is not a rubber stamp", () => {
  const desadv = samples()["retailer-DESADV"].text;
  it("fails when a mandatory segment is missing", () => {
    expect(() => independentCheck(desadv.replace(/BGM\+[^']*'\n/, ""))).toThrow(/mandatory segment BGM/);
  });
  it("fails when a segment is out of place", () => {
    expect(() => independentCheck(desadv.replace("CPS+1'\n", "CPS+1'\nNAD+DP+9520020007779::9'\n"))).toThrow();
  });
  it("fails when an element is too long or an unknown segment appears", () => {
    expect(() => independentCheck(desadv.replace("DTM+137:", "DTM+1370:"))).toThrow(/exceeds maximum length/);
    expect(() => independentCheck(desadv.replace("PCI+33E'", "PCX+33E'"))).toThrow();
  });
});
