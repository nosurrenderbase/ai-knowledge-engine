import {AntdRegistry} from '@ant-design/nextjs-registry';
import type {Metadata} from 'next';
import {Inter, JetBrains_Mono} from 'next/font/google';
import type {ReactNode} from 'react';
import {Providers} from '@/components/providers';
import './globals.css';

const sans = Inter({subsets: ['latin', 'latin-ext'], variable: '--font-sans', display: 'swap'});
const mono = JetBrains_Mono({subsets: ['latin', 'latin-ext'], variable: '--font-mono', display: 'swap'});

export const metadata: Metadata = {title: 'Efsane Başkan · Knowledge Engine'};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="tr" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
