import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Trading Grid Portal (prototype)" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="banner">
          Prototype with fictional data. Local ERP simulator only. Demo-only authentication. No live email,
          marketplace or ERP connections.
        </div>
        {children}
      </body>
    </html>
  );
}
