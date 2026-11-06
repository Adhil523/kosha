import './globals.css';
import { AppFooter } from '@/components/elements/AppFooter';
import { QueryProvider } from '@/components/elements/QueryProvider';
import { cn } from '@/lib/utils';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Kosha Console',
  description:
    'Earnings, TDS ledger, escrow and filing export for Kosha, the tax-native x402 gateway.'
};

const RootLayout = ({ children }: LayoutProps<'/'>) => (
  <html lang="en" className={cn(geistSans.variable, geistMono.variable, 'h-full antialiased')}>
    <body className="flex min-h-full flex-col">
      <QueryProvider>{children}</QueryProvider>
      <AppFooter />
    </body>
  </html>
);

export default RootLayout;
