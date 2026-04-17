"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/admin/dashboard" },
  { label: "Chains", href: "/admin/chains" },
  { label: "Recommendations", href: "/admin/recommendations" },
  { label: "Campaigns", href: "/admin/campaigns" },
  { label: "Approvals", href: "/admin/approvals" },
  { label: "Tax Write-off", href: "/admin/tax-writeoff" },
  { label: "SDG Report", href: "/admin/sdg-report" },
  { label: "Settings", href: "/admin/settings" },
];

export default function AdminShell({ children, user }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="admin-shell">
      <nav className="admin-topnav">
        <span className="admin-brand">SYNAPTOS</span>
        <div className="admin-nav">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              className={`admin-nav-link ${pathname.startsWith(item.href) ? "is-active" : ""}`}
              href={item.href}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <div className="admin-userbar">
          <Badge tone={user?.role === "admin" ? "blue" : "green"}>{user?.role ?? "session"}</Badge>
          <Button size="sm" variant="secondary" onClick={handleLogout}>
            Logout
          </Button>
        </div>
      </nav>
      <main className="admin-content">{children}</main>
    </div>
  );
}
