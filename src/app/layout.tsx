import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'buerli — Cabinet Studio',
  description: 'Low-code 3D parametric configurator',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-panel text-gray-100 antialiased">{children}</body>
    </html>
  );
}
