// Retailer compliance for outbound X12 (D47, D75). Every generated 855, 856 and 810 is parsed back from its own text
// and checked against the rules of the trading partner's profile (x12.ts) before it may be sent. A rule that fails
// with severity "block" stops the send and the screen shows why. The rules are inferred from the X12 standard and
// from arithmetic; a retailer's own implementation guide adds more. docs/08-edi-mapping.md lists them.
import { Dec } from "./money";
import { checkX12, X12_LABEL } from "./x12";

export type EdiKind = "ORDRSP" | "DESADV" | "INVOIC";

// ---------- profiles ----------

export const PROFILE_IDS = ["x12_retail"] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];
export const PROFILES: Record<ProfileId, { name: string; summary: string }> = {
  x12_retail: { name: "US retail X12 baseline",
    summary: "ANSI X12 004010 855, 856 and 810 with GLNs, UPCs (GTIN-12), SSCCs, dates and totals checked. Rules inferred "
      + "from the X12 standard; a retailer's own guide adds more." },
};

/** "19", "19.00" and "19.0" are the same rate: fixed point without trailing zeros. */
export const rateKey = (d: Dec) => { const f = d.toFixedPoint(); return f.includes(".") ? f.replace(/0+$/, "").replace(/\.$/, "") : f; };

// ---------- running the checks ----------

export interface Finding {
  ruleId: string; severity: "block" | "warn"; text: string; basis: "sourced" | "inferred"; sources: string[];
}
export interface ComplianceResult {
  profile: ProfileId; kind: EdiKind; rulesChecked: number; rulesPassed: number; findings: Finding[];
}

export const checkMessage = (kind: EdiKind, text: string, profile: ProfileId): ComplianceResult => checkX12(kind, text);

export const blocking = (r: ComplianceResult) => r.findings.filter((f) => f.severity === "block");

/** One sentence for a refusal: "The retailer would reject this ship notice (X12 856): a; b." */
export const refusal = (r: ComplianceResult) =>
  `The retailer would reject this ${X12_LABEL[r.kind]} (${PROFILES[r.profile].name}): ${blocking(r).map((f) => f.text).join(" ")}`;
