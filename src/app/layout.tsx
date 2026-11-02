import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sugar Saathi",
  description: "A private family diary, one confirmed reading at a time.",
  robots: { index: false, follow: false, noarchive: true },
  appleWebApp: { capable: true, title: "Sugar Saathi", statusBarStyle: "default" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
