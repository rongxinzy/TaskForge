import "./globals.css";
import Link from "next/link";
import { ReactNode } from "react";
import { AuthStatus } from "@/components/auth-status";
import { apiFetch } from "@/lib/api";
import { Inter } from "next/font/google";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata = {
  title: "TaskForge",
  description: "Local Runner-first AI-native engineering workspace",
};

async function getCurrentUser() {
  try {
    return await apiFetch<{ id: string; email: string; name: string }>(
      "/api/users/me",
    );
  } catch {
    return null;
  }
}

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();

  return (
    <html lang="en" className={cn("font-sans", inter.variable)}>
      <body>
        <TooltipProvider>
          <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
            <Link
              href="/"
              className="text-xl font-bold text-indigo-600 hover:text-indigo-700"
            >
              TaskForge
            </Link>
            <AuthStatus initialUser={user} />
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        </TooltipProvider>
      </body>
    </html>
  );
}
