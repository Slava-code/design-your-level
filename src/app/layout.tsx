import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

/*
 * Fonts are self-hosted from public/fonts via next/font/local (font-display: swap).
 * Each exposes a raw CSS variable (--ff-*) on <html>; globals.css maps them to
 * semantic role tokens (--font-body, --font-display, --font-terminal, ...).
 * UI code should use the role tokens, never the --ff-* names.
 */
const plex = localFont({
  src: "../../public/fonts/ibm-plex-sans-var-latin.woff2",
  weight: "100 700",
  display: "swap",
  variable: "--ff-plex",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Arial", "sans-serif"],
});

const bricolage = localFont({
  src: "../../public/fonts/bricolage-grotesque-var-latin.woff2",
  weight: "700 800",
  display: "swap",
  variable: "--ff-bricolage",
  fallback: ["Arial Black", "Helvetica Neue", "Arial", "sans-serif"],
});

const vt323 = localFont({
  src: "../../public/fonts/vt323-400-latin.woff2",
  weight: "400",
  display: "swap",
  variable: "--ff-vt323",
  fallback: ["ui-monospace", "Menlo", "Consolas", "monospace"],
});

const specialElite = localFont({
  src: "../../public/fonts/special-elite-400-latin.woff2",
  weight: "400",
  display: "swap",
  variable: "--ff-special-elite",
  preload: false,
  fallback: ["Courier New", "Courier", "monospace"],
});

const dmSerif = localFont({
  src: "../../public/fonts/dm-serif-display-400-latin.woff2",
  weight: "400",
  display: "swap",
  variable: "--ff-dm-serif",
  preload: false,
  fallback: ["Georgia", "Times New Roman", "serif"],
});

const limelight = localFont({
  src: "../../public/fonts/limelight-400-latin.woff2",
  weight: "400",
  display: "swap",
  variable: "--ff-limelight",
  preload: false,
  fallback: ["Georgia", "serif"],
});

const caveat = localFont({
  src: "../../public/fonts/caveat-600-latin.woff2",
  weight: "600",
  display: "swap",
  variable: "--ff-caveat",
  preload: false,
  fallback: ["Comic Sans MS", "cursive"],
});

const spaceGrotesk = localFont({
  src: "../../public/fonts/space-grotesk-var-latin.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--ff-space",
  preload: false,
  fallback: ["system-ui", "Arial", "sans-serif"],
});

const fontVars = [plex, bricolage, vt323, specialElite, dmSerif, limelight, caveat, spaceGrotesk]
  .map((f) => f.variable)
  .join(" ");

export const metadata: Metadata = {
  title: "Design Your Level",
  description:
    "Live classroom activity: design a game level with your team, get an AI storyboard, then vote for the best one.",
  applicationName: "Design Your Level",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#06140B",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVars}>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
