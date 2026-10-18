// The /api/extract route handler, called directly (no server, no network).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "../../app/api/extract/route";
import { EMAILS } from "../domain/__fixtures__/maple";

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
  delete process.env.ORDER_AGENT_EXTRACTOR;
});
afterEach(() => { process.env = { ...saved }; });

const post = (body: string) => POST(new Request("http://localhost/api/extract", { method: "POST", body }));

describe("/api/extract", () => {
  it("GET reports availability without a key", async () => {
    expect(await GET().json()).toStrictEqual({ extraction: "unavailable", extractor_mode: "gemini", model: null });
  });

  it("POST in rehearsal mode returns the TEST ADAPTER's evidence-checked version", async () => {
    const pages = EMAILS.cheese.attachments[0].pageText;
    const res = await post(JSON.stringify({ pages, rehearsal: true }));
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.ok).toBe(true);
    expect(out.payload.extractor.is_ai).toBe(false);
    expect(out.payload.header.total).toMatchObject({ value: "6,815.00", evidence_verified: true });
  });

  it("POST without a key and outside rehearsal says extraction is unavailable", async () => {
    const res = await post(JSON.stringify({ pages: ["PO: X"], rehearsal: false }));
    expect((await res.json()).status).toBe("extraction_unavailable");
  });

  it.each([
    ["not json"], [JSON.stringify({ pages: [] , rehearsal: true })], [JSON.stringify({ pages: ["x"] })],
    [JSON.stringify({ pages: ["x"], rehearsal: true, pdf: "<not base64>" })], [JSON.stringify({ pages: [1], rehearsal: true })],
    [JSON.stringify({ pages: Array(51).fill("x"), rehearsal: true })],
  ])("POST refuses a malformed body: %s", async (body) => {
    expect((await post(body)).status).toBe(400);
  });

  it("POST refuses page text over the request size limit", async () => {
    const res = await post(JSON.stringify({ pages: ["x".repeat(4_100_000)], rehearsal: true }));
    expect(res.status).toBe(413);
  });
});
