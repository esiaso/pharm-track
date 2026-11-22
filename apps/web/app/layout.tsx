import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'PharmTrack', description: 'SynergyOne pharmacy management' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <strong>PharmTrack</strong>
          <nav>
            <a href="/formulary">Formulary</a>
            <a href="/dispensing">Dispensing queue</a>
            <a href="/refills">Refills</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
