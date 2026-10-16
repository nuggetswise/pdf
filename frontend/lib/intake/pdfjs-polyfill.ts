// pdf.js 6 uses Map.prototype.getOrInsertComputed (a 2026 JavaScript addition) when drawing pages. Browsers that
// lack it (older Chrome, Safari, Firefox) would fail to draw the page view, so it is added here if missing.
type Getter<K, V> = (key: K) => V;
for (const C of [Map, WeakMap] as unknown as { prototype: Record<string, unknown> }[]) {
  const p = C.prototype as unknown as {
    has(k: unknown): boolean; get(k: unknown): unknown; set(k: unknown, v: unknown): unknown;
    getOrInsert?: (k: unknown, v: unknown) => unknown; getOrInsertComputed?: (k: unknown, f: Getter<unknown, unknown>) => unknown;
  };
  if (!p.getOrInsert) {
    Object.defineProperty(p, "getOrInsert", { configurable: true, writable: true,
      value(this: typeof p, k: unknown, v: unknown) { if (!this.has(k)) this.set(k, v); return this.get(k); } });
  }
  if (!p.getOrInsertComputed) {
    Object.defineProperty(p, "getOrInsertComputed", { configurable: true, writable: true,
      value(this: typeof p, k: unknown, f: Getter<unknown, unknown>) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); } });
  }
}
export {};
