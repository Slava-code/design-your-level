import type { Metadata } from "next";
import QRCode from "qrcode";
import { ScreenApp } from "@/components/admin/ScreenApp";

export const metadata: Metadata = {
  title: "Projector | Design Your Level",
  robots: { index: false, follow: false },
};

const PLAY_URL = "https://play.mottonote.app";

export default async function ScreenPage() {
  // Ink-on-transparent QR, drawn on the parchment card. Generated on the server, so no QR code ships to the browser bundle.
  const qrSvg = await QRCode.toString(PLAY_URL, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 0,
    color: { dark: "#1A120AFF", light: "#00000000" },
  });
  return <ScreenApp qrSvg={qrSvg} playHost="play.mottonote.app" />;
}
