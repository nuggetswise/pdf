// Test helper: the example purchase order (D60) received and read with the labelled test adapter (not AI).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as pdfjsNode from "pdfjs-dist/legacy/build/pdf.mjs";
import { intakeEml } from "../../intake/intake";
import type { PdfJs } from "../../intake/pdf";
import { emptyRunState } from "../run-state";
import { receive, resetDemo } from "../workflow";
import { ADMIN, INTAKE_ACTOR, extract, tickClock } from "./demo";

const pdfjs = pdfjsNode as unknown as PdfJs;
const EML = join(__dirname, "..", "..", "..", "..", "fixtures", "example", "PO-2026-104587.eml");

export async function exampleRun() {
  const clock = tickClock();
  const got = await intakeEml(new Uint8Array(readFileSync(EML)), "local_forward_demo", { pdfjs });
  let s = resetDemo(emptyRunState(clock.now()), ADMIN, clock);
  const r = receive(s, got.envelope, got.attachments, INTAKE_ACTOR, clock);
  s = extract(r.state, r.documentIds[0], clock);
  return { s, docId: r.documentIds[0], clock };
}

