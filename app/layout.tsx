import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "Карточка оценки клиента";
const description =
  "Рабочий инструмент Antikrizis для оценки клиента, оформления договора и передачи карточки юристам.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const imageUrl = host ? `${protocol}://${host}/og.png` : undefined;

  return {
    title,
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title,
      description,
      type: "website",
      images: imageUrl ? [{ url: imageUrl }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: imageUrl ? [imageUrl] : undefined,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isOldSite = process.env.SITE_STATUS === "old";
  const replacementUrl = process.env.OLD_SITE_REPLACEMENT_URL;

  return (
    <html lang="ru">
      <body>
        {isOldSite && (
          <aside className="old-site-banner" role="status">
            <strong>СТАРАЯ ВЕРСИЯ САЙТА</strong>
            <span>Не используйте её для новой работы.</span>
            {replacementUrl && <a href={replacementUrl}>Открыть новую версию →</a>}
          </aside>
        )}
        {children}
      </body>
    </html>
  );
}
