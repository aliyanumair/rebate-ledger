import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MarginsRecovery — Find every rebate you earned",
  description: "A clear, auditable workspace for supplier rebate reconciliation.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
