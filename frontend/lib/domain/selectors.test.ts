// Rebuild slice 5: the screens now read the run through selectors.ts instead of the FastAPI read endpoints.
// After the 15-step guided demo, every selector gives exactly what the Python endpoint returned (timestamps
// masked). read-models.json is made by scripts/read_models.py from the prototype itself.
import { describe, expect, it } from "vitest";
import { maskTimes } from "./__fixtures__/demo";
import readModels from "./__fixtures__/read-models.json";
import { replayGuidedDemo } from "./__fixtures__/replay";
import {
  currentPolicy, documentDetail, documentsList, erpOrdersList, ordersList, rulesList,
} from "./selectors";
import { summary } from "./workflow";

const py = readModels as unknown as Record<string, unknown> & {
  document: Record<string, unknown>; text: Record<string, { pages: string[] }>;
  erp_orders: (Record<string, unknown> & { payload_json: string; payload: unknown })[];
};
const run = replayGuidedDemo();
const ts = <T>(v: T) => maskTimes(v);
// D62-D64 read fields (source kind, route, supervision, hold, email text) are TypeScript-only; the Python endpoints had none.
const SUMMARY_EXTRA = ["kind", "channel", "customer_id", "po_number", "review_state", "open_issues", "issue_codes", "body_text", "attachment_names"];
const withoutExtra = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));

describe("selectors give what the Python read endpoints gave", () => {
  it("GET /api/documents", () => expect(ts(documentsList(run).map((d) => withoutExtra(d, SUMMARY_EXTRA)))).toStrictEqual(py.documents));

  for (const id of Object.keys(py.document)) {
    it(`GET /api/documents/${id} and its /text`, () => {
      const { pages, kind: _k, classification: _c, channel: _ch, supervision: _s, hold: _h, ...detail } = documentDetail(run, Number(id))!;
      const envelope = withoutExtra(detail.envelope, ["body_text", "attachments"]);
      expect(ts({ ...detail, envelope })).toStrictEqual(py.document[id]);
      expect(pages).toStrictEqual(py.text[id].pages);
    });
  }

  it("GET /api/orders", () => expect(ts(ordersList(run))).toStrictEqual(py.orders));
  it("GET /api/memory-rules", () => expect(ts(rulesList(run))).toStrictEqual(py.memory_rules));
  it("GET /api/erp/orders (without the duplicate payload_json string)", () => {
    const want = py.erp_orders.map(({ payload_json, ...rest }) => {
      expect(JSON.parse(payload_json)).toStrictEqual(rest.payload);
      return rest;
    });
    expect(ts(erpOrdersList(run))).toStrictEqual(want);
  });
  it("GET /api/policy", () => expect(ts(currentPolicy(run))).toStrictEqual(py.policy));
  it("GET /api/summary", () => expect(summary(run)).toStrictEqual(py.summary));
  it("an unknown document has no detail", () => expect(documentDetail(run, 99)).toBeNull());
});
