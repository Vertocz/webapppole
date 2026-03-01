import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pôle France Parabasket Adapté",
  description: "Application de suivi du Pôle France Para Basketball Adapté",
  icons: { icon: "🏀" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
