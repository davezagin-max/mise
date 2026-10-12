import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Young_Serif } from "next/font/google";
import { RegisterServiceWorker } from "@/components/app/RegisterServiceWorker";
import { KeyProvider } from "@/components/kit/KeyProvider";
import { THEME_INIT_SCRIPT } from "@/components/kit/theme-script";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Young_Serif({
  variable: "--font-display-face",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Mise: fridge to meal plan",
  description:
    "Photograph your fridge and get a week of meals that use what you have, with macros computed from nutrition data and a grocery list.",
  applicationName: "Mise",
  appleWebApp: { capable: true, title: "Mise", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5eedd" },
    { media: "(prefers-color-scheme: dark)", color: "#161912" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
        >
          Skip to content
        </a>
        <KeyProvider>{children}</KeyProvider>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
