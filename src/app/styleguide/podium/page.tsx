import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectorDemo } from "./ProjectorDemo";

export const metadata: Metadata = { title: "Projector demo | Design Your Level", robots: { index: false } };

// Dev-only projector mock; hidden in production builds.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const sp = await searchParams;
  const raw = Number(Array.isArray(sp.step) ? sp.step[0] : sp.step);
  const step = (raw >= 0 && raw <= 3 ? Math.floor(raw) : 0) as 0 | 1 | 2 | 3;
  const view = sp.view === "timer" ? "timer" : "podium";
  return <ProjectorDemo initialStep={step} view={view} />;
}
