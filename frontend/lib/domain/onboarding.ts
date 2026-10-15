// Session onboarding (D46): customers and products a reviewer added while processing real purchase orders.
// The additions live in RunState.referenceOverlay and are merged over the reference data for validation only.
// The bundled or imported reference file is never changed, and the version shows that additions are in use.
import type { ReferenceOverlay } from "./run-state";
import type { Reference } from "./validation";

export const SESSION_SUFFIX = " + session additions";
export const SESSION_MOQ_VERSION = "session addition";

export function overlayIsEmpty(ov: ReferenceOverlay | undefined): boolean {
  return !ov || (ov.customers.length + ov.customerAliases.length + ov.shipTos.length + ov.products.length === 0);
}

/** Reference data plus this session's additions. Returns the base object unchanged when there are none. */
export function mergeReference(base: Reference, ov: ReferenceOverlay | undefined): Reference {
  if (!ov || overlayIsEmpty(ov)) return base;
  const ref = structuredClone(base);
  ref.base_reference_version = base.reference_version;
  ref.reference_version = `${base.reference_version}${SESSION_SUFFIX}`;
  for (const c of ov.customers) {
    ref.customers.push({ customer_id: c.customerId, name: c.name, currency: c.currency,
      ship_tos: c.shipToIds.map((id) => ({ ship_to_id: id })), ship_to_not_on_file: c.shipToIds.length === 0 });
  }
  for (const st of ov.shipTos) {
    ref.customers.find((c) => c.customer_id === st.customerId)?.ship_tos.push({ ship_to_id: st.shipToId });
  }
  ref.customer_name_aliases = ov.customerAliases.map((a) => ({ printed: a.printed, customer_id: a.customerId }));
  for (const p of ov.products) {
    ref.products.push({ sku: p.sku, description: p.description, gtin: p.gtin, unit: p.unit });
    if (p.customerItemCode && !p.gtin) {
      ref.customer_aliases = [...(ref.customer_aliases ?? []),
        { customer_id: p.customerId, customer_item_code: p.customerItemCode, sku: p.sku }];
    }
    ref.reference_prices = [...(ref.reference_prices ?? []),
      { customer_id: p.customerId, sku: p.sku, unit: p.unit, currency: p.currency, price: p.price }];
    ref.moq_rules = [...(ref.moq_rules ?? []),
      { customer_id: p.customerId, sku: p.sku, minimum: p.moq, unit: p.unit, version: SESSION_MOQ_VERSION }];
  }
  return ref;
}
