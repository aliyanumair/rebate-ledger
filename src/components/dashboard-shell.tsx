"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";

type User = { name: string; role: string; company: string; email: string };
export function DashboardShell({ children }: { children: ReactNode }) {
  const path = usePathname(); const router = useRouter(); const [user, setUser] = useState<User | null>(null); const [ready, setReady] = useState(false);
  useEffect(() => { const raw = localStorage.getItem("rebateledger:session"); if (raw) setUser(JSON.parse(raw)); setReady(true); }, []);
  useEffect(() => { if (ready && !user) router.replace("/login"); }, [ready, user, router]);
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); localStorage.removeItem("rebateledger:session"); router.push("/login"); }
  if (!ready || !user) return <div className="loading-shell"><span className="brand-mark">R</span><span>Opening your workspace…</span></div>;
  const admin = user.role === "Admin";
  const links = admin ? [{ href: "/dashboard", label: "Audit intake queue", icon: "⇧" }] : [{ href: "/dashboard", label: "Overview", icon: "◫" }, { href: "/dashboard/audits/demo-q3", label: "Supplier audits", icon: "▤" }, { href: "/dashboard/upload", label: "New audit", icon: "+" }];
  return <div className="app-frame"><aside className="sidebar"><Link className="brand sidebar-brand" href="/dashboard"><span className="brand-mark">R</span><span>rebateledger</span></Link><div className="sidebar-caption">WORKSPACE</div><nav className="side-nav">{links.map(link => <Link key={link.href} href={link.href} className={(path === link.href || (link.href !== "/dashboard" && path.startsWith(link.href))) ? "active" : ""}><span className="side-icon">{link.icon}</span>{link.label}{link.label === "Audit intake queue" && <span className="nav-count">{typeof window === "undefined" ? 0 : JSON.parse(localStorage.getItem("rebateledger:intakes") || "[]").length}</span>}</Link>)}</nav><div className="sidebar-spacer"/><div className="sidebar-help"><span>?</span><div><b>Need a hand?</b><small>Review the demo workflow</small></div></div><button className="user-menu" onClick={logout}><span className="user-avatar">{user.name.split(" ").map(x => x[0]).join("").slice(0,2)}</span><span><b>{user.name}</b><small>{user.role} · Sign out</small></span><span className="user-more">⌄</span></button></aside><div className="app-main"><header className="app-topbar"><div className="breadcrumb">Workspace <span>/</span> {admin ? "Admin" : "Client"}</div><div className="topbar-actions"><span className="demo-flag">DEMO ENVIRONMENT</span><button className="icon-button" title="Notifications">♧<i/></button><span className="user-avatar top-avatar">{user.name.split(" ").map(x => x[0]).join("").slice(0,2)}</span></div></header><main className="dashboard-content">{children}</main></div></div>;
}
