import './globals.css';
import { cn } from '@/lib/utils';
import type { Metadata } from 'next';
import { Host_Grotesk, JetBrains_Mono } from 'next/font/google';

const hostGrotesk = Host_Grotesk({ variable: '--font-host', subsets: ['latin'] });
const jetBrainsMono = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Kosha: every agent payment, tax-ready',
  description:
    'Kosha is an x402 payment gateway on Hedera. AI agents pay Indian APIs in USDC, and Kosha withholds the Indian TDS in the same transaction.'
};

const RootLayout = ({ children }: LayoutProps<'/'>) => (
  <html
    lang="en"
    className={cn(hostGrotesk.variable, jetBrainsMono.variable, 'h-full antialiased')}
  >
    <body className="flex min-h-full flex-col">{children}</body>
  </html>
);

export default RootLayout;
