// D50: the simulated Trading Grid web form sends ANSI X12 004010 (855, 856, 810) for the fictional US demo
// retailer. No independent X12 parser is installed, so these are structural checks on our own output plus the
// X12 rule checks; the committed samples in fixtures/edi-samples/*.x12 let a reviewer read the result.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REVIEWER } from "./__fixtures__/demo";
import { replayGuidedDemo } from "./__fixtures__/replay";
import { portalForOrder, submitAsn, submitInvoice } from "./portal";
import { checkX12, parseX12, xesc } from "./x12";

const clock = { now: () => "2026-10-15T09:30:00.000Z" };
const SAMPLES = join(__dirname, "../../../fixtures/edi-samples");

function demo() {
  let s = submitAsn(replayGuidedDemo(), 1, { lines: [{ lineIndex: 0, shippedQty: "4" }, { lineIndex: 1, shippedQty: "2" },
    { lineIndex: 2, shippedQty: "1" }], estimatedDelivery: "2026-10-20", packing: { cartonsPerPallet: 2 } }, REVIEWER, clock);
  s = submitInvoice(s, portalForOrder(s, 1).asn!.id, { lines: [{ lineIndex: 0, quantity: "4" }, { lineIndex: 1, quantity: "2" },
    { lineIndex: 2, quantity: "1" }] }, REVIEWER, clock);
  const p = portalForOrder(s, 1);
  const body = (m: { kind: string; body: string }[], k: string) => m.find((x) => x.kind === k)!.body;
  return { "demo-855": { kind: "ORDRSP" as const, text: p.confirmation!.body },
    "demo-856": { kind: "DESADV" as const, text: body(p.asnMessages, "DESADV") },
    "demo-810": { kind: "INVOIC" as const, text: body(p.invoiceMessages, "INVOIC") } };
}

describe("X12 output for the fictional US demo retailer", () => {
  const all = demo();
  for (const [name, { kind, text }] of Object.entries(all)) {
    it(`${name}: envelope is well formed and every X12 rule passes`, () => {
      const isa = text.split("\n")[0];
      expect(isa).toHaveLength(106); // fixed width, segment terminator included
      expect(isa.split("*")[15]).toBe("T"); // test data
      const segs = parseX12(text);
      const st = segs.findIndex((s) => s.tag === "ST");
      const se = segs.findIndex((s) => s.tag === "SE");
      expect(Number(segs[se].els[0])).toBe(se - st + 1);
      expect(checkX12(kind, text).findings).toEqual([]);
    });
    it(`${name}: committed sample in fixtures/edi-samples is current`, () => {
      const file = join(SAMPLES, `${name}.x12`);
      if (process.env.UPDATE_EDI_SAMPLES === "1") writeFileSync(file, text);
      expect(existsSync(file) ? readFileSync(file, "utf8") : "(missing)").toBe(text);
    });
  }

  it("the 856 carries pallet and carton SSCCs, the 810 bills the shipped quantity in cents", () => {
    expect(all["demo-856"].text.match(/^MAN\*GM\*\d{18}~$/gm)!.length).toBeGreaterThan(1);
    expect(all["demo-810"].text).toMatch(/^IT1\*1\*4\*/m);
    expect(all["demo-810"].text).toContain("TDS*16600~");
  });

  it("a tampered total, count or GTIN is caught", () => {
    const inv = all["demo-810"].text;
    expect(checkX12("INVOIC", inv.replace("TDS*16600~", "TDS*16500~")).findings.map((f) => f.ruleId)).toContain("X12-TOTAL");
    const asn = all["demo-856"].text;
    expect(checkX12("DESADV", asn.replace(/^SE\*(\d+)\*/m, "SE*1*")).findings.map((f) => f.ruleId)).toContain("X12-ENVELOPE");
    expect(checkX12("DESADV", asn.replace("614141000012", "614141000013")).findings.map((f) => f.ruleId)).toContain("X12-ITEM-GTIN");
  });

  it("separators in untrusted text cannot start a new element or segment", () => {
    expect(xesc("ACME*~>^\nCORP")).toBe("ACME     CORP");
  });
});
