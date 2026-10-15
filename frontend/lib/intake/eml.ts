// Browser-side .eml parsing (port of intake.parse_eml). The subject is kept as metadata only (P28).
import PostalMime from "postal-mime";
import { IntakeRejected, MAX_UPLOAD_BYTES } from "./pdf";

export interface ParsedEmail {
  envelope: { messageId: string | null; sender: string | null; receivedAt: string | null; subjectMetadata: string | null };
  attachments: { filename: string | null; data: Uint8Array }[];
}

export async function parseEml(raw: Uint8Array, maxBytes = MAX_UPLOAD_BYTES): Promise<ParsedEmail> {
  if (raw.length > maxBytes * 2) throw new IntakeRejected("too_large", "Email exceeds size limit");
  let msg: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    msg = await PostalMime.parse(raw.slice());
  } catch {
    throw new IntakeRejected("invalid", "Email could not be read");
  }
  const dateHeader = msg.headers.find((h) => h.key === "date")?.value;
  const from = msg.from;
  const sender = from && "address" in from && from.address
    ? (from.name ? `${from.name} <${from.address}>` : from.address)
    : (msg.headers.find((h) => h.key === "from")?.value || null);
  const attachments = msg.attachments
    .filter((a) => a.mimeType === "application/pdf" || (a.filename ?? "").toLowerCase().endsWith(".pdf"))
    .map((a) => ({
      filename: a.filename ?? null,
      data: typeof a.content === "string" ? new TextEncoder().encode(a.content) : new Uint8Array(a.content),
    }));
  if (!attachments.length) throw new IntakeRejected("invalid", "Email has no PDF attachment");
  return {
    envelope: {
      messageId: msg.messageId || null,
      sender: sender || null,
      receivedAt: dateHeader ? rfc2822ToIso(dateHeader) : null,
      subjectMetadata: msg.subject || null,
    },
    attachments,
  };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ZONES: Record<string, number> = { UT: 0, UTC: 0, GMT: 0, Z: 0, EST: -300, EDT: -240, CST: -360, CDT: -300,
  MST: -420, MDT: -360, PST: -480, PDT: -420 };
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** email.utils.parsedate_to_datetime(...).isoformat(): keeps the sender's own offset. Unreadable dates give null.
 *  "-0000" (offset unknown) is recorded as +00:00, where Python would drop the offset (DECISIONS.md D37). */
export function rfc2822ToIso(value: string): string | null {
  const m = /^\s*(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[A-Za-z]{1,3})?\s*(?:\(.*\))?\s*$/
    .exec(value);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = MONTHS.indexOf(m[2].toLowerCase());
  let year = Number.parseInt(m[3], 10);
  if (m[3].length <= 2) year += year > 68 ? 1900 : 2000;
  const [hh, mi, ss] = [m[4], m[5], m[6] ?? "0"].map((x) => Number.parseInt(x, 10));
  if (month < 0 || hh > 23 || mi > 59 || ss > 59) return null;
  const check = new Date(Date.UTC(year, month, day));
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month) return null;
  let offset = 0;
  const zone = m[7];
  if (zone && /^[+-]\d{4}$/.test(zone)) {
    const sign = zone[0] === "-" ? -1 : 1;
    const zh = Number.parseInt(zone.slice(1, 3), 10);
    const zm = Number.parseInt(zone.slice(3), 10);
    if (zm > 59) return null;
    offset = sign * (zh * 60 + zm);
  } else if (zone) {
    offset = ZONES[zone.toUpperCase()] ?? 0;
  }
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${pad(year, 4)}-${pad(month + 1)}-${pad(day)}T${pad(hh)}:${pad(mi)}:${pad(ss)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
