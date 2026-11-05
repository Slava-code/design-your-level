import type { Metadata } from "next";
import { AdminApp } from "@/components/admin/AdminApp";

export const metadata: Metadata = {
  title: "Control room | Design Your Level",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminApp />;
}
