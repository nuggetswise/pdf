"use client";
import type { DocDetail } from "./api";

/** What the agent did with this PDF, step by step, from the run's own data; nothing here is a canned script. */
export function AgentWorkPanel({ d }: { d: DocDetail }) {
  const o = d.order;
  const payload = d.latest_version?.payload;
  if (!o || !payload) return null;
  const v = o.validation.order;
  const fieldsRead = [payload.header, ...payload.lines].flatMap((f) => Object.values(f)).filter((x) => x.value != null);
  const verified = fieldsRead.filter((x) => x.evidence_verified).length;
  const matched = v.lines.filter((l) => l.sku).length;
  const fromMemory = v.lines.filter((l) => l.resolved_by?.type === "memory_rule").length;
  const issues = o.validation.issues;
  const open = issues.filter((i) => i.status === "open").length;
  const delivered = o.delivery_state === "erp_created";
  return (
    <section className="agent-work" aria-label="What the Order Agent did">
      <h4>What the agent did with this PDF</h4>
      <ol>
        <li><b>Read the PDF{payload.extractor.is_ai ? " with AI" : " (rehearsal adapter, not AI)"}.</b> Pulled {fieldsRead.length} values from {d.pages.length} page{d.pages.length === 1 ? "" : "s"}; {verified} were found word for word in the PDF text, so you can click any value and see where it came from.</li>
        <li><b>Matched it to your records.</b> Customer {v.customer_name ?? "not recognised"}{v.customer_id ? ` (${v.customer_id})` : ""}, and {matched} of {v.lines.length} lines to products in your catalogue.</li>
        <li><b>Checked every line</b> against your price list, minimum order quantities and retired GTINs: {issues.length === 0 ? "all checks passed." : `${issues.length} item${issues.length === 1 ? "" : "s"} need${issues.length === 1 ? "s" : ""} a decision: ${issues.map((i) => i.title).join("; ")}.`}</li>
        {fromMemory > 0 && <li><b>Fixed {fromMemory} line{fromMemory === 1 ? "" : "s"} from memory</b>, using a correction an administrator approved on an earlier order.</li>}
        <li><b>{delivered ? "Sent it to your ERP" : open > 0 ? `Waiting on you for ${open} decision${open === 1 ? "" : "s"}` : "Ready to approve"}.</b> {delivered ? "Nothing was retyped. The ASN and invoice are pre-filled under Sent." : "Once decided, it goes to your ERP by itself and the ASN and invoice are pre-filled. "}</li>
      </ol>
    </section>
  );
}
