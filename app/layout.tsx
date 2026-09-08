import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: 'Word.html — 打出来，记得住',
  description: '按科目整理单词、术语和概念，通过连续打字与释义默写练到真正熟悉。',
  openGraph: {
    title: 'Word.html — 打出来，记得住',
    description: '按科目整理单词、术语和概念，通过连续打字与释义默写练到真正熟悉。',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Word.html — 打出来，记得住' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Word.html — 打出来，记得住',
    description: '按科目整理单词、术语和概念，通过连续打字与释义默写练到真正熟悉。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
