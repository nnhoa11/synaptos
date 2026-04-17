import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import { getSessionUserFromServer } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }) {
  const user = await getSessionUserFromServer();

  if (!["admin", "manager"].includes(user?.role)) {
    redirect("/");
  }

  return <AdminShell user={user}>{children}</AdminShell>;
}
