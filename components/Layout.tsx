"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";

interface LayoutProps {
  children: React.ReactNode;
  userName: string;
  tabs: { id: string; label: string; icon: string }[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  theme: "joueur" | "staff";
}

export default function Layout({ children, userName, tabs, activeTab, onTabChange, theme }: LayoutProps) {
  const router = useRouter();

  return (
    <div className="relative min-h-screen z-10">
      {/* Stripe décorative top */}
      <div className="header-stripe w-full" />

      {/* Header */}
      <header
        className="sticky top-0 z-50 px-4 py-3"
        style={{
          background: "color-mix(in srgb, var(--bg-base) 92%, transparent)",
          backdropFilter: "blur(14px)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div
              className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center shrink-0"
              style={{ background: "white", padding: "3px" }}
            >
              <Image src="/logo.png" alt="Logo" width={36} height={36} style={{ objectFit: "contain" }} />
            </div>
            <div>
              <p className="font-display text-base leading-none" style={{ color: "var(--text-main)" }}>
                PÔLE FRANCE
              </p>
              <p
                className="text-[10px] tracking-widest uppercase font-light"
                style={{ color: "var(--text-sub)" }}
              >
                Para Basketball Adapté
              </p>
            </div>
          </div>

          {/* Right */}
          <div className="flex items-center gap-2">
            <div className="text-right hidden sm:block">
              <p className="text-xs uppercase tracking-widest font-light" style={{ color: "var(--text-sub)" }}>
                {theme === "staff" ? "Staff" : "Joueur"}
              </p>
              <p className="text-sm font-medium" style={{ color: "var(--text-main)" }}>{userName}</p>
            </div>
            <button
              onClick={() => { sessionStorage.clear(); router.push("/"); }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                border: "1px solid var(--border)",
                color: "var(--text-sub)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-main)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-sub)")}
            >
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      {/* Tab Nav */}
      <nav
        className="px-4"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="max-w-2xl mx-auto flex gap-0 overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className="flex items-center gap-1.5 px-4 py-3.5 text-sm font-medium whitespace-nowrap transition-all relative"
                style={{
                  color: isActive ? "var(--tab-active)" : "var(--text-muted)",
                  borderBottom: isActive ? "2px solid var(--tab-active)" : "2px solid transparent",
                  marginBottom: "-1px",
                }}
              >
                <span className="text-base">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
