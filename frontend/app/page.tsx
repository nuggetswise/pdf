"use client";
import { useEffect, useState } from "react";

type Health = { status: string; extraction: string; erp: string };

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main style={{ padding: 24 }}>
      <h1>PDF Order Agent</h1>
      {error && <p role="alert">Backend not reachable: {error}</p>}
      {!health && !error && <p>Connecting to backend...</p>}
      {health && (
        <ul>
          <li>Backend: {health.status}</li>
          <li>Extraction: {health.extraction}</li>
          <li>ERP: {health.erp}</li>
        </ul>
      )}
    </main>
  );
}
