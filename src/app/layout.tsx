import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: process.env.APP_NAME ?? 'AutoBlog',
  description: 'AI research, writing, images — published to your Blogger blogs.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
