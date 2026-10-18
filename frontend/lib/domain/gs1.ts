// GS1 identification keys used in EANCOM messages (D47): GLN (party/location), GTIN (trade item) and
// SSCC (logistic unit: pallet or carton). All three end in the same GS1 mod-10 check digit.
//
// Fictional identifiers use GS1 prefix 952, which GS1 reserves for demonstrations and examples, so they can
// never belong to a real company (GS1 General Specifications; GS1 prefix list, https://www.gs1.org/prefixes).

/** GS1 mod-10 check digit for a body of digits: weights 3 and 1 alternate, starting with 3 at the right. */
export function gs1CheckDigit(body: string): string {
  if (!/^\d+$/.test(body)) throw new Error("GS1 key body must be digits");
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const fromRight = body.length - 1 - i;
    sum += "0123456789".indexOf(body[i]) * (fromRight % 2 === 0 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}

const validKey = (v: string | null | undefined, lengths: number[]): boolean =>
  !!v && /^\d+$/.test(v) && lengths.includes(v.length) && gs1CheckDigit(v.slice(0, -1)) === v.slice(-1);

/** GTIN-8, -12, -13 or -14 with a correct check digit. */
export const isGtin = (v: string | null | undefined) => validKey(v, [8, 12, 13, 14]);
/** 13-digit GLN with a correct check digit. */
export const isGln = (v: string | null | undefined) => validKey(v, [13]);
/** 18-digit SSCC with a correct check digit. */
export const isSscc = (v: string | null | undefined) => validKey(v, [18]);

/** A 13-digit GLN from 12 digits plus the check digit. */
export function gln(twelve: string): string {
  if (!/^\d{12}$/.test(twelve)) throw new Error("GLN body must be 12 digits");
  return twelve + gs1CheckDigit(twelve);
}

/** GS1 company prefix: 6 to 12 digits (GS1 General Specifications, GS1 Company Prefix). */
export const isCompanyPrefix = (v: string | null | undefined) => !!v && /^\d{6,12}$/.test(v);

/**
 * SSCC = extension digit + GS1 company prefix + serial reference (together 17 digits) + check digit.
 * The serial must never be reused by the same company; here it is a counter held in the run (see D47).
 */
export function sscc(companyPrefix: string, serial: number, extension = "0"): string {
  if (!isCompanyPrefix(companyPrefix)) throw new Error("GS1 company prefix must be 6 to 12 digits");
  const width = 16 - companyPrefix.length;
  const ref = String(serial);
  if (!Number.isSafeInteger(serial) || serial < 1 || ref.length > width) throw new Error("SSCC serial out of range");
  const body = extension + companyPrefix + ref.padStart(width, "0");
  return body + gs1CheckDigit(body);
}

/** GS1's demonstration prefix (952) as a 7-digit company prefix for the fictional supplier. */
export const DEMO_COMPANY_PREFIX = "9520000";
export const FICTIONAL_GLN = {
  supplier: gln("952000000001"),
  retailer: gln("952000000002"),
} as const;
/** Fictional GLN for a demo customer or ship-to: 952 prefix, a kind digit and a sequence number. */
export const fictionalGln = (kind: "buyer" | "ship_to", n: number) =>
  gln(`95200${kind === "buyer" ? "1" : "2"}${String(n).padStart(6, "0")}`);
export const FICTIONAL_LABEL = "Fictional identifiers (GS1 example prefix 952). Test environment: nothing is sent to a real partner.";
