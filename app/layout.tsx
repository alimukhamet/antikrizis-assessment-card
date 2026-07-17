import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Договор и карточка клиента",
  description:
    "Рабочий инструмент Antikrizis для оценки клиента, оформления договора и передачи карточки юристам.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
