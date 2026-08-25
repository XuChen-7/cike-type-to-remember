import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: '词刻 — 用打字加深记忆',
  description: '按科目整理词条，通过连续打字与释义默写加深记忆。',
  openGraph: {
    title: '词刻 — 用打字加深记忆',
    description: '按科目整理词条，通过连续打字与释义默写加深记忆。',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: '词刻 — 用打字加深记忆' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '词刻 — 用打字加深记忆',
    description: '按科目整理词条，通过连续打字与释义默写加深记忆。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
