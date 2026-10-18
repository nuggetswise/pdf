// maple-inbox.json is what intake made of each fixtures/maple email (envelope, attachments with page text). It is
// generated, never edited: UPDATE_MAPLE_INBOX=1 npx vitest run lib/domain/__fixtures__/maple-inbox.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as pdfjsNode from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, it } from "vitest";
import { intakeEml } from "../../intake/intake";
import type { PdfJs } from "../../intake/pdf";

const DIR = join(__dirname, "..", "..", "..", "..", "fixtures", "maple");
const FILE = join(__dirname, "maple-inbox.json");
const pdfjs = pdfjsNode as unknown as PdfJs;
/** Test name -> email file. Names say what the email is for. */
export const FILES: Record<string, string> = {
  milk: "PO-2026-104620.eml", cheese: "PO-2026-104633.eml", moq: "tests/PO-2026-104701.eml",
  gtin1: "tests/PO-2026-104702.eml", gtin2: "tests/PO-2026-104703.eml", gtin3: "tests/PO-2026-104704.eml",
  gtin4: "tests/PO-2026-104705.eml", each: "tests/PO-2026-104706.eml", otherBuyer: "tests/PO-2026-104707.eml",
  badShipTo: "tests/PO-2026-104708.eml", milkRevision: "tests/PO-2026-104620-r2.eml",
};

it("maple-inbox.json is current", async () => {
  const emails: Record<string, unknown> = {};
  for (const [name, file] of Object.entries(FILES)) {
    const got = await intakeEml(new Uint8Array(readFileSync(join(DIR, file))), "order_mailbox", { pdfjs });
    emails[name] = { envelope: got.envelope, attachments: got.attachments };
  }
  const built = { _label: "FICTIONAL TEST DATA. Generated from fixtures/maple by maple-inbox.test.ts; do not edit.", emails };
  if (process.env.UPDATE_MAPLE_INBOX) writeFileSync(FILE, JSON.stringify(built, null, 2) + "\n");
  expect(JSON.parse(readFileSync(FILE, "utf8"))).toStrictEqual(JSON.parse(JSON.stringify(built)));
});
