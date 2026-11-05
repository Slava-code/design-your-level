import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StyleguideClient } from "./StyleguideClient";

export const metadata: Metadata = {
  title: "Styleguide | Design Your Level",
  robots: { index: false, follow: false },
};

// Dev-only component gallery; hidden in production builds.
export default function StyleguidePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <StyleguideClient />;
}
