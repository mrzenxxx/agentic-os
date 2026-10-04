import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-inter" });

export const metadata = {
  title: "Health Coach Agent",
  description: "Коуч по образу жизни с проверкой плана Safety Reviewer",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={cn("font-sans antialiased", inter.variable)}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Перейти к содержимому
        </a>
        {children}
      </body>
    </html>
  );
}
