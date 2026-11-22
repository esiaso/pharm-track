import type { ReactNode } from 'react';
import { Header } from '../components/Header';
import { SessionProvider } from '../lib/session';
import './globals.css';

export const metadata = { title: 'PharmTrack', description: 'SynergyOne pharmacy management' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <Header />
          <main>{children}</main>
        </SessionProvider>
      </body>
    </html>
  );
}
