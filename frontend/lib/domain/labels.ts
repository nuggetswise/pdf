// D51: GS1-128 logistic labels for the SSCCs on an ASN. Each pallet and carton gets a label whose barcode
// encodes Application Identifier (00) + the 18-digit SSCC, so the retailer's dock can scan it against the 856.
// Code 128 set C with FNC1 first, as GS1 General Specifications section 5.4 defines GS1-128. Bar widths come
// from the Code 128 symbology table (ISO/IEC 15417); the table below was copied from ReportLab's code128.py.
import type { Asn, RunState } from "./run-state";
import { isSscc } from "./gs1";

const PATTERNS = ["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"];
const START_C = 105;
const FNC1 = 102;
const STOP = 106;

/** Code 128 symbol values for a GS1-128 barcode of an even-length digit string (set C, FNC1 first). */
export function gs1128Values(digits: string): number[] {
  if (!/^(\d\d)+$/.test(digits)) throw new Error("GS1-128 set C needs an even number of digits");
  const data = [FNC1, ...digits.match(/\d\d/g)!.map(Number)];
  const check = data.reduce((sum, v, i) => sum + v * (i + 1), START_C) % 103;
  return [START_C, ...data, check, STOP];
}

/** Alternating bar and space widths in modules, bar first, with no quiet zones. */
export function gs1128Widths(digits: string): number[] {
  return gs1128Values(digits).flatMap((v) => [...PATTERNS[v]].map(Number));
}

/** An SVG barcode for (00) + SSCC; quiet zones of 10 modules each side. */
export function ssccBarcodeSvg(sscc: string, height = 80): string {
  if (!isSscc(sscc)) throw new Error(`Not a valid SSCC: ${sscc}`);
  const widths = gs1128Widths(`00${sscc}`);
  const total = widths.reduce((a, b) => a + b, 0) + 20;
  let x = 10;
  const bars: string[] = [];
  widths.forEach((w, i) => { if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`); x += w; });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none" role="img" `
    + `aria-label="GS1-128 barcode (00) ${sscc}"><rect width="${total}" height="${height}" fill="#fff"/><g fill="#000">${bars.join("")}</g></svg>`;
}

/** Human-readable SSCC as printed under the barcode: (00) 0 9520000 000000001 1. */
export const ssccText = (sscc: string) => `(00) ${sscc}`;

export interface Label { kind: "pallet" | "carton"; sscc: string; index: string; contents: { sku: string; gtin: string | null;
  description: string | null; quantity: string; unit: string }[] }

/** One label per pallet and carton on the ASN, in packing order. */
export function labelsFor(s: RunState, asn: Asn): Label[] {
  const byLine = new Map(asn.lines.map((l) => [l.lineIndex, l]));
  const item = (lineIndex: number, quantity: string) => {
    const l = byLine.get(lineIndex)!;
    return { sku: l.sku, gtin: l.gtin, description: l.description, quantity, unit: l.unit };
  };
  void s;
  return (asn.pallets ?? []).flatMap((p, pi) => [
    { kind: "pallet" as const, sscc: p.sscc, index: `Pallet ${pi + 1} of ${asn.pallets!.length}`,
      contents: p.cartons.flatMap((c) => c.contents.map((x) => item(x.lineIndex, x.quantity))) },
    ...p.cartons.map((c, ci) => ({ kind: "carton" as const, sscc: c.sscc, index: `Carton ${ci + 1} of ${p.cartons.length} on pallet ${pi + 1}`,
      contents: c.contents.map((x) => item(x.lineIndex, x.quantity)) })),
  ]);
}
