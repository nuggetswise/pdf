"use client";
import { useCallback, useEffect, useState } from "react";
import { api, DocDetail, DocSummary, Field, Health } from "./api";

const STEPS = ["Received", "Extracting", "Matching", "Validating", "Needs review / Ready", "Submitting", "ERP created"];
const STATUS_LABEL: Record<string, [string, string]> = {
  received: ["Received", "info"], extracting: ["Extracting", "info"], extracted: ["Extracted", "ok"],
  extraction_unavailable: ["Extraction unavailable", "warn"], extraction_failed: ["Extraction failed", "bad"],
  unsupported: ["Unsupported (no text)", "bad"], duplicate: ["Duplicate file", "warn"],
};
const STOPPED = new Set(["extraction_unavailable", "extraction_failed", "unsupported", "duplicate"]);
const HEADER_LABELS: [string, string][] = [
  ["po_number", "PO number"], ["customer_name", "Customer"], ["customer_id", "Customer ID"], ["supplier", "Supplier"],
  ["ship_to_id", "Ship-to"], ["order_date", "Order date"], ["requested_delivery_date", "Delivery date"],
  ["currency", "Currency"], ["subtotal", "Subtotal"], ["tax", "Tax"], ["shipping", "Shipping"], ["total", "Total"],
];
const LINE_COLS: [string, string][] = [
  ["source_line_id", "Line"], ["gtin", "GTIN / ID"], ["customer_item_code", "Customer item"], ["description", "Description"],
  ["quantity", "Qty"], ["unit", "Unit"], ["unit_price", "Unit price"], ["line_amount", "Amount"],
];

function fmt(ts: string | null) {
  return ts ? new Date(ts).toLocaleString() : "unknown";
}

function StatusChip({ status }: { status: string }) {
  const [label, tone] = STATUS_LABEL[status] ?? [status, "info"];
  return <span className={`chip ${tone}`}>{label}</span>;
}

function stepIndex(status: string) {
  if (status === "received") return 0;
  if (status === "extracting") return 1;
  if (status === "extracted") return 2; // Matching is built in Slice 3; shown as not started
  return 1;
}

function Timeline({ status }: { status: string }) {
  const at = stepIndex(status);
  const stopped = STOPPED.has(status);
  return (
    <div className="timeline" aria-label="Processing timeline">
      {STEPS.map((s, i) => {
        const waiting = status === "extracted"; // nothing runs after extraction until Slice 3
        const cls = i < at ? "done" : i === at && !waiting ? (stopped ? "stop" : "now") : "";
        return <span key={s} className={`step ${cls}`}>{s}</span>;
      })}
    </div>
  );
}

function Value({ f }: { f?: Field }) {
  if (!f || f.value === null) return <span className="null">not on document</span>;
  return (
    <span title={f.evidence ?? ""}>
      {f.value} {!f.evidence_verified && <span className="chip bad">not found in PDF</span>}
    </span>
  );
}

export default function Inbox() {
  const [health, setHealth] = useState<Health | null>(null);
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [demoEmails, setDemoEmails] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await api<DocSummary[]>("/api/documents");
      setDocs(list);
      if (selected !== null) setDetail(await api<DocDetail>(`/api/documents/${selected}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selected]);

  useEffect(() => {
    api<Health>("/api/health").then(setHealth).catch((e: Error) => setError(e.message));
    api<string[]>("/api/demo/emails").then((l) => { setDemoEmails(l); setPick(l[0] ?? ""); }).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [refresh]);

  async function forward() {
    setBusy(true);
    try {
      const r = await api<{ document_ids: number[] }>(`/api/demo/forward/${encodeURIComponent(pick)}`, { method: "POST" });
      setSelected(r.document_ids[0]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    const body = new FormData();
    body.append("file", file);
    setBusy(true);
    try {
      const r = await api<{ document_ids: number[] }>("/api/intake/eml", { method: "POST", body });
      setSelected(r.document_ids[0]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function retry(id: number) {
    try {
      await api(`/api/documents/${id}/retry-extraction`, { method: "POST" });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const version = detail?.latest_version;
  return (
    <>
      <header className="topbar">
        <h1>PDF Order Agent</h1>
        {health && (
          <span className={`chip ${health.extraction === "available" ? "ok" : "warn"}`}>
            Extraction: {health.extraction}
            {health.extractor_mode === "test" ? " (TEST ADAPTER)" : health.model ? ` (${health.model})` : ""}
          </span>
        )}
        <span className="chip">ERP: local simulator</span>
      </header>
      {error && <div className="alert bad" role="alert" style={{ margin: "12px 20px 0" }}>{error}</div>}
      <div className="layout">
        <section className="panel">
          <h2>Local demo inbox</h2>
          <div className="forward">
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Demo email">
              {demoEmails.map((n) => <option key={n}>{n}</option>)}
            </select>
            <button className="primary" disabled={!pick || busy} onClick={forward}>Forward to agent</button>
          </div>
          <p className="ev">Forwarding here imports a local fictional .eml. Nothing is sent over the internet.</p>
          <label className="ev" style={{ display: "block", marginBottom: 12 }}>
            Or import an .eml file:{" "}
            <input type="file" accept=".eml,message/rfc822" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          {docs === null && <p className="empty">Loading...</p>}
          {docs?.length === 0 && <p className="empty">No forwarded emails yet. Forward a demo email to start.</p>}
          {docs?.map((d) => (
            <div key={d.id} className={`mail ${selected === d.id ? "active" : ""}`} onClick={() => setSelected(d.id)}>
              <div className="from">{d.sender ?? "unknown sender"}</div>
              <div className="meta"><span>{fmt(d.received_at)}</span><StatusChip status={d.status} /></div>
              <div className="meta"><span>{d.original_filename ?? "attachment"}</span><span>#{d.id}</span></div>
            </div>
          ))}
        </section>

        <section className="panel">
          {!detail && <p className="empty">Select an email to see processing.</p>}
          {detail && (
            <>
              <h2>Order document #{detail.document.id}</h2>
              <Timeline status={detail.document.status} />
              {detail.document.status_detail && (
                <div className={`alert ${detail.document.status === "duplicate" ? "warn" : "bad"}`}>
                  {detail.document.status_detail}
                  {["extraction_failed", "extraction_unavailable"].includes(detail.document.status) && (
                    <button style={{ marginLeft: 10 }} onClick={() => retry(detail.document.id)}>Retry extraction</button>
                  )}
                </div>
              )}
              <div className="grid2">
                <div>
                  <div className="kv">
                    <div>From</div><div>{detail.envelope.sender ?? "unknown"}</div>
                    <div>Received</div><div>{fmt(detail.envelope.received_at)}</div>
                    <div>Message ID</div><div className="ev">{detail.envelope.message_id ?? "none"}</div>
                    <div>Subject (metadata only)</div><div>{detail.envelope.subject_metadata ?? ""}</div>
                    <div>Attachment</div><div>{detail.document.original_filename} ({detail.document.page_count} page)</div>
                    <div>File hash</div><div className="ev">{detail.document.sha256.slice(0, 16)}...</div>
                    <div>Intake</div><div>{detail.envelope.intake_mode}</div>
                  </div>
                  {version && (
                    <>
                      <h2>Extracted fields, version {version.version}</h2>
                      <p className="ev">
                        Extractor: {version.payload.extractor.name}
                        {version.payload.extractor.is_ai ? " (AI extraction)" : ""}. Hover a value to see source text.
                      </p>
                      <table>
                        <tbody>
                          {HEADER_LABELS.map(([k, label]) => (
                            <tr key={k}>
                              <th>{label}</th>
                              <td><Value f={version.payload.header[k]} /></td>
                              <td className="ev">{version.payload.header[k]?.page ? `p.${version.payload.header[k].page}` : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <h2 style={{ marginTop: 16 }}>Lines</h2>
                      <div className="scroll">
                        <table>
                          <thead><tr>{LINE_COLS.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
                          <tbody>
                            {version.payload.lines.map((line, i) => (
                              <tr key={i}>{LINE_COLS.map(([k]) => <td key={k}><Value f={line[k]} /></td>)}</tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
                <div>
                  <h2>Source PDF</h2>
                  <iframe title="Source PDF" src={`/api/documents/${detail.document.id}/pdf`} />
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
