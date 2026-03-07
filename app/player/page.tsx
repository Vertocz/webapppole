"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import ThemeProvider from "@/components/ThemeProvider";
import Billets from "@/components/Billets";
import SuiviSportif from "@/components/SuiviSportif";
import SuiviForme from "@/components/SuiviForme";
import PreparationMentale from "@/components/PreparationMentale";
import Tournois from "@/components/Tournois";
import BadgesTab from "@/components/BadgesTab";
import BadgePopup from "@/components/BadgePopup";
import ProfilModal from "@/components/ProfilModal";
import type { Joueuse } from "@/types";
import { supabase } from "@/lib/supabase";
import PwaBanner from "@/components/PwaBanner";
import NotificationsPermission from "@/components/NotificationsSetup";
import { useBadges } from "@/lib/useBadges";
import { usePushSubscription } from "@/hooks/usePushSubscription";

const ALL_BASE_TABS = [
  { id: "billets",  label: "Billets",          icon: "🎫" },
  { id: "sportif",  label: "Suivi sportif",     icon: "⛹️‍♀️" },
  { id: "forme",    label: "Forme quotidienne", icon: "🧘‍♀️" },
];
const TAB_MENTALE  = { id: "mentale",  label: "Prépa mentale", icon: "🧠" };
const TAB_TOURNOIS = { id: "tournois", label: "Tournois",      icon: "🏆" };
const TAB_BADGES   = { id: "badges",   label: "Badges",        icon: "🏅" };

export default function JoueuseePage() {
  const [user,          setUser]          = useState<Joueuse | null>(null);
  const [activeTab,     setActiveTab]     = useState("sportif");
  const [hasBillets,    setHasBillets]    = useState(false);
  const [hasBadges,     setHasBadges]     = useState(false);
  const [newBadgeIds,   setNewBadgeIds]   = useState<string[]>([]);
  const [badgesChecked, setBadgesChecked] = useState(false);
  const [telephone,     setTelephone]     = useState("");
  const [profilOpen,    setProfilOpen]    = useState(false);
  const router = useRouter();
  const { checkAndAward } = useBadges();

  usePushSubscription({
    userId: user?.id ?? null,
    role: "player",
    pole: user?.categorie === "Masculin" ? "masculin" : "feminin",
  });

  useEffect(() => {
    const stored = sessionStorage.getItem("user");
    const type   = sessionStorage.getItem("type_user");
    if (!stored || type !== "joueuse") { router.push("/"); return; }
    const parsed = JSON.parse(stored) as Joueuse;
    setUser(parsed);
    setTelephone(parsed.numero_tel ?? "");

    // Billets
    supabase.from("billets").select("id").eq("joueuse_id", parsed.id).limit(1)
      .then(({ data }) => setHasBillets((data ?? []).length > 0));

    // Badges déjà acquis ?
    supabase.from("badges_joueur").select("id")
      .eq("joueur_id", parsed.id).eq("joueur_type", "joueur").limit(1)
      .then(({ data }) => { setHasBadges((data ?? []).length > 0); setBadgesChecked(true); });

    // Vérification et attribution des badges
    checkAndAward(parsed.id, "joueur", parsed.categorie, parsed.prenom, parsed.nom, (ids) => {
      setNewBadgeIds(ids);
      setHasBadges(true);
    });
  }, [router, checkAndAward]);

  const handleSave = useCallback(() => {
    if (!user) return;
    checkAndAward(user.id, "joueur", user.categorie, user.prenom, user.nom, (ids) => {
      setNewBadgeIds(ids);
      setHasBadges(true);
    });
  }, [user, checkAndAward]);

  const handlePhoneUpdated = (newPhone: string) => {
    setTelephone(newPhone);
    // Met aussi à jour le sessionStorage pour la session courante
    const stored = sessionStorage.getItem("user");
    if (stored) {
      const parsed = JSON.parse(stored);
      parsed.numero_tel = newPhone;
      sessionStorage.setItem("user", JSON.stringify(parsed));
    }
  };

  const Spinner = () => (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
    </div>
  );

  if (!user)          return <Spinner />;
  if (!badgesChecked) return <Spinner />;

  const isMasculin = user.categorie === "Masculin";
  const BASE_TABS  = ALL_BASE_TABS.filter(t => t.id !== "billets" || hasBillets);
  const tabs = [
    ...BASE_TABS,
    ...(isMasculin ? [TAB_MENTALE] : []),
    TAB_TOURNOIS,
    ...(hasBadges ? [TAB_BADGES] : []),
  ];

  return (
    <>
      <ThemeProvider theme="joueur" />

      <Layout
        userName={`${user.prenom} ${user.nom}`}
        userId={user.id}
        userType="joueuse"
        prenom={user.prenom}
        nom={user.nom}
        telephone={telephone}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onPhoneUpdated={handlePhoneUpdated}
        theme="joueur"
      >
        {activeTab === "billets"  && <Billets userId={user.id} />}
        {activeTab === "sportif"  && <SuiviSportif userId={user.id} onSave={handleSave} />}
        {activeTab === "forme"    && <SuiviForme userId={user.id} onSave={handleSave} />}
        {activeTab === "mentale"  && isMasculin && <PreparationMentale userId={user.id} onSave={handleSave} />}
        {activeTab === "tournois" && <Tournois />}
        {activeTab === "badges"   && <BadgesTab userId={user.id} userType="joueur" categorie={user.categorie} />}
      </Layout>

      <PwaBanner />
      <NotificationsPermission />

      {newBadgeIds.length > 0 && (
        <BadgePopup
          badgeIds={newBadgeIds}
          onDone={() => setNewBadgeIds([])}
          categorie={user.categorie}
        />
      )}

      {profilOpen && (
        <ProfilModal
          role="player"
          pole={user.categorie === "Masculin" ? "masculin" : "feminin"}
          userId={user.id}
          userType="joueuse"
          prenom={user.prenom}
          nom={user.nom}
          telephone={telephone}
          onClose={() => setProfilOpen(false)}
          onPhoneUpdated={(newPhone) => {
            handlePhoneUpdated(newPhone);
            setProfilOpen(false);
          }}
        />
      )}
    </>
  );
}