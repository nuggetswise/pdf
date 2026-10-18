import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Trading Grid Portal" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="banner">
          Test environment. All data is fictional. The mailbox, your ERP and Trading Grid are simulated, and nothing
          reaches a real retailer.
        </div>
        {children}
      </body>
    </html>
  );
}
