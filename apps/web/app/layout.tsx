import type { ReactNode } from 'react';
import { AppShell, SessionGate } from '../components/Header';
import { SessionProvider } from '../lib/session';
import { themeScript } from '../lib/theme';
import './globals.css';

export const metadata = { title: 'PharmTrack', description: 'SynergyOne pharmacy management' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <SessionProvider>
          <AppShell>
            <SessionGate>{children}</SessionGate>
          </AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}
