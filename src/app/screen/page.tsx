import type { Metadata } from "next";
import QRCode from "qrcode";
import { ScreenApp } from "@/components/admin/ScreenApp";

export const metadata: Metadata = {
  title: "Projector | Design Your Level",
  robots: { index: false, follow: false },
};

// Public URL teams open on their phones (shown and encoded as a QR code on the projector lobby).
const PLAY_URL = process.env.PLAY_URL || "http://localhost:3000";

export default async function ScreenPage() {
  // Ink-on-transparent QR, drawn on the parchment card. Generated on the server, so no QR code ships to the browser bundle.
  const qrSvg = await QRCode.toString(PLAY_URL, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 0,
    color: { dark: "#1A120AFF", light: "#00000000" },
  });
  return <ScreenApp qrSvg={qrSvg} playHost={new URL(PLAY_URL).host} />;
}
