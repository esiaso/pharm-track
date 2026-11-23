import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import { AppShell } from '../components/Header';
import { SessionProvider } from '../lib/session';
import './globals.css';

// Inter, served from this app (SIL OFL 1.1, see app/fonts/Inter-OFL.txt). No font CDN.
const inter = localFont({
  src: './fonts/inter-latin-wght.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-inter',
});

export const metadata = { title: 'PharmTrack', description: 'SynergyOne pharmacy management' };

// Applies the saved light/dark choice before the first paint.
const themeScript = `try{var t=localStorage.getItem('pt-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <SessionProvider>
          <AppShell>{children}</AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}
