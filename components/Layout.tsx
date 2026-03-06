"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import ProfilModal from "@/components/ProfilModal";

interface LayoutProps {
  children: React.ReactNode;
  userName: string;
  userId: string;
  userType: "joueuse" | "staff";
  prenom: string;
  nom: string;
  telephone: string;
  tabs: { id: string; label: string; icon: string }[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  onPhoneUpdated: (newPhone: string) => void;
  theme: "joueur" | "staff";
}

export default function Layout({ children, userName, userId, userType, prenom, nom, telephone, tabs, activeTab, onTabChange, onPhoneUpdated, theme }: LayoutProps) {
  const router = useRouter();
  const [profilOpen, setProfilOpen] = useState(false);

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
            <button
              onClick={() => setProfilOpen(true)}
              className="text-right transition-opacity hover:opacity-70 active:opacity-50"
            >
              <p className="text-xs uppercase tracking-widest font-light" style={{ color: "var(--text-sub)" }}>
                {theme === "staff" ? "Staff" : "Joueur"}
              </p>
              <p className="text-sm font-medium underline decoration-dotted underline-offset-2" style={{ color: "var(--text-main)", textDecorationColor: "var(--border)" }}>{userName}</p>
            </button>
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

      {/* Modal profil */}
      {profilOpen && (
        <ProfilModal
          userId={userId}
          userType={userType}
          prenom={prenom}
          nom={nom}
          telephone={telephone}
          onClose={() => setProfilOpen(false)}
          onPhoneUpdated={(newPhone) => {
            onPhoneUpdated(newPhone);
            setProfilOpen(false);
          }}
        />
      )}
    </div>
  );
}