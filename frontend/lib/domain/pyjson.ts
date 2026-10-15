// Python's json.dumps(value) with default settings (", " and ": " separators, ensure_ascii), so issue
// fingerprints and parity checks are identical to the Python prototype byte for byte.

const ESC: Record<string, string> = { '"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };

function str(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (ESC[ch]) out += ESC[ch];
    else if (code < 0x20 || code > 0x7e) out += "\\u" + code.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

export function pyJsonDumps(value: unknown, sortKeys = false): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return str(value);
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error("pyJsonDumps: only integers are supported");
    return String(value);
  }
  if (Array.isArray(value)) return "[" + value.map((v) => pyJsonDumps(v, sortKeys)).join(", ") + "]";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (sortKeys) entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return "{" + entries.map(([k, v]) => `${str(k)}: ${pyJsonDumps(v, sortKeys)}`).join(", ") + "}";
  }
  throw new Error(`pyJsonDumps: unsupported ${typeof value}`);
}
