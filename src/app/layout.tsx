import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '商务标报价系统',
  description: '建筑工程商务标报价配平系统',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
