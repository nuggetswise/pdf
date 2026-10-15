export type Field = { value: string | null; page: number | null; evidence: string | null; evidence_verified: boolean; notes: string[] };
export type Health = { status: string; extraction: string; extractor_mode: string; model: string | null; erp: string };
export type DocSummary = {
  id: number; status: string; status_detail: string | null; original_filename: string | null; duplicate_of: number | null;
  created_at: string; sender: string | null; received_at: string | null; message_id: string | null; intake_mode: string;
};
export type DocDetail = {
  document: DocSummary & { sha256: string; page_count: number; envelope_id: number };
  envelope: { message_id: string | null; sender: string | null; received_at: string | null; subject_metadata: string | null; intake_mode: string };
  latest_version: null | { version: number; extractor: string; payload: { extractor: { name: string; is_ai: boolean }; header: Record<string, Field>; lines: Record<string, Field>[] } };
  timeline: { event: string; actor: string; created_at: string; detail: Record<string, unknown> }[];
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { cache: "no-store", ...init });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${r.status}`);
  }
  return r.json();
}
