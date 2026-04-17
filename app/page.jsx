import { redirect } from "next/navigation";
import { getSessionUserFromServer } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getSessionUserFromServer();

  if (user && ["admin", "manager"].includes(user.role)) {
    redirect("/admin/dashboard");
  }

  if (user?.storeId) {
    redirect(`/pos?storeId=${encodeURIComponent(user.storeId)}`);
  }

  redirect("/admin/dashboard");
}
