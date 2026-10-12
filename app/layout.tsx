import '@/frontend/styles/globals.css';
import type { Metadata, Viewport } from 'next';
import Nav from '@/frontend/components/Nav';

export const metadata: Metadata = { title: 'Match Day Optimizer', description: 'Dream11 team builder that learns from every match.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0a0f1c' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
