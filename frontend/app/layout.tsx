import type { ReactNode } from "react";

export const metadata = { title: "PDF Order Agent (prototype)" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#f7f7f8" }}>
        <div style={{ background: "#7a4b00", color: "#fff", padding: "6px 16px", fontSize: 13 }}>
          Prototype with fictional data. Local ERP simulator only. Demo-only authentication.
        </div>
        {children}
      </body>
    </html>
  );
}
