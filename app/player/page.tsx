"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import ThemeProvider from "@/components/ThemeProvider";
import Billets from "@/components/Billets";
import SuiviSportif from "@/components/SuiviSportif";
import SuiviForme from "@/components/SuiviForme";
import PreparationMentale from "@/components/PreparationMentale";
import type { Joueuse } from "@/types";
import PwaBanner from "@/components/PwaBanner";
import NotificationsPermission, { useOneSignal } from "@/components/NotificationsSetup";

const BASE_TABS = [
  { id: "billets",  label: "Billets",           icon: "🎫" },
  { id: "sportif",  label: "Suivi sportif",      icon: "⛹️‍♀️" },
  { id: "forme",    label: "Forme quotidienne",  icon: "🧘‍♀️" },
];
const TAB_MENTALE = { id: "mentale", label: "Prépa mentale", icon: "🧠" };

export default function JoueuseePage() {
  const [user, setUser] = useState<Joueuse | null>(null);
  const [activeTab, setActiveTab] = useState("billets");
  const router = useRouter();
  useOneSignal(user?.id ?? null);

  useEffect(() => {
    const stored = sessionStorage.getItem("user");
    const type = sessionStorage.getItem("type_user");
    if (!stored || type !== "joueuse") { router.push("/"); return; }
    setUser(JSON.parse(stored));
  }, [router]);

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
    </div>
  );

  const isMasculin = user.categorie === "Masculin";
  const tabs = isMasculin ? [...BASE_TABS, TAB_MENTALE] : BASE_TABS;

  return (
    <>
      <ThemeProvider theme="joueur" />
      <Layout userName={`${user.prenom} ${user.nom}`} tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} theme="joueur">
        {activeTab === "billets"  && <Billets userId={user.id} />}
        {activeTab === "sportif"  && <SuiviSportif userId={user.id} />}
        {activeTab === "forme"    && <SuiviForme userId={user.id} />}
        {activeTab === "mentale" && isMasculin && <PreparationMentale userId={user.id} />}
      </Layout>
      <PwaBanner />
      <NotificationsPermission />
    </>
  );
}
