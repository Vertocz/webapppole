"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import ThemeProvider from "@/components/ThemeProvider";
import Billets, { prefetchBilletsOffline } from "@/components/Billets";
import { prefetchQuizOffline } from "@/components/games/Quiz";
import CarteAvantage from "@/components/CarteAvantage";
import SuiviSportif from "@/components/SuiviSportif";
import SuiviForme from "@/components/SuiviForme";
import PreparationMentale from "@/components/PreparationMentale";
import Tournois from "@/components/Tournois";
import BadgesTab from "@/components/BadgesTab";
import BadgePopup from "@/components/BadgePopup";
import GamesTab from "@/components/games/GamesTab";
import VictorinisTab from "@/components/VictorinisTab";
import CarteModal from "@/components/CarteModal";
import { tirerCarte, type CarteGagnee } from "@/lib/victorinis";
import type { Joueuse } from "@/types";
import { supabase } from "@/lib/supabase";
import { getSession, updateSessionUser } from "@/lib/session";
import { consumePendingRewards, SYNC_EVENT } from "@/lib/offline";
import PwaBanner from "@/components/PwaBanner";
import NotificationsPrompt from "@/components/NotificationsPrompt";
import NotificationsInbox from "@/components/NotificationsInbox";
import { useBadges } from "@/lib/useBadges";
import NotifModal from "@/components/NotifModal";
import QuestionnaireTab from "@/components/QuestionnaireTab";

const ALL_BASE_TABS = [
  { id: "billets", label: "Billets", icon: "🎫" },
  { id: "sportif", label: "Suivi sportif", icon: "⛹️‍♀️" },
  { id: "forme", label: "Forme quotidienne", icon: "🧘‍♀️" },
];
const TAB_MENTALE = { id: "mentale", label: "Prépa mentale", icon: "🧠" };
const TAB_TOURNOIS = { id: "tournois", label: "Tournois", icon: "🏆" };
const TAB_BADGES = { id: "badges", label: "Badges", icon: "🏅" };
const TAB_JEUX = { id: "jeux", label: "Jeux", icon: "🎮" };
const TAB_CARTE = { id: "carte", label: "Ma carte", icon: "💳" };
const TAB_VICTORINIS = { id: "victorinis", label: "Victorinis", icon: "🃏" };
const TAB_QUESTIONNAIRE = { id: "questionnaire", label: "Questionnaire", icon: "📝" };

export default function JoueuseePage() {
  const [user, setUser] = useState<Joueuse | null>(null);
  const [activeTab, setActiveTab] = useState("sportif");
  const [hasBillets, setHasBillets] = useState(false);
  const [hasCarte, setHasCarte] = useState(false);
  const [hasBadges, setHasBadges] = useState(false);
  const [newBadgeIds, setNewBadgeIds] = useState<string[]>([]);
  const [badgesChecked, setBadgesChecked] = useState(false);
  const [telephone, setTelephone] = useState("");
  const [notifId, setNotifId] = useState<string | null>(null);
  const router = useRouter();
  const { checkAndAward } = useBadges();
  const [hasQuestionnaire, setHasQuestionnaire] = useState(false);
  const [carteGagnee, setCarteGagnee] = useState<CarteGagnee | null>(null);
  const [cartesRefresh, setCartesRefresh] = useState(0);

  useEffect(() => {
    const session = getSession<Joueuse>();
    if (!session || session.type !== "joueuse") {
      router.replace("/");
      return;
    }
    const parsed = session.user;
    setUser(parsed);
    setTelephone(parsed.numero_tel ?? "");

    // Prépare le hors ligne : billets PDF à venir + questions du quiz
    prefetchBilletsOffline(parsed.id);
    if (parsed.acces_jeux) prefetchQuizOffline();

    // Rafraîchit le profil (accès jeux, Victorinis…) maintenant que la session dure
    supabase
      .from("joueuses")
      .select("*")
      .eq("id", parsed.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        updateSessionUser(data);
        setUser((u) => (u ? { ...u, ...data } : u));
      });

    supabase
      .from("billets")
      .select("id")
      .eq("joueuse_id", parsed.id)
      .limit(1)
      .then(({ data }) => setHasBillets((data ?? []).length > 0));
    supabase
      .from("questionnaire_destinataires")
      .select("id")
      .eq("joueuse_id", parsed.id)
      .limit(1)
      .then(({ data }) => setHasQuestionnaire((data ?? []).length > 0));

    supabase
      .from("cartes")
      .select("id")
      .eq("joueuse_id", parsed.id)
      .limit(1)
      .then(({ data }) => setHasCarte((data ?? []).length > 0));

    supabase
      .from("badges_joueur")
      .select("id")
      .eq("joueur_id", parsed.id)
      .eq("joueur_type", "joueur")
      .limit(1)
      .then(({ data }) => {
        setHasBadges((data ?? []).length > 0);
        setBadgesChecked(true);
      });

    checkAndAward(parsed.id, "joueur", parsed.categorie, parsed.prenom, parsed.nom, (ids) => {
      setNewBadgeIds(ids);
      setHasBadges(true);
    });

    // Détection notif_id dans l'URL (clic depuis une notification push)
    const params = new URLSearchParams(window.location.search);
    const nid = params.get("notif_id");
    if (nid) {
      setNotifId(nid);
      // Nettoyer l'URL sans recharger la page
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [router, checkAndAward]);

  const handleSave = useCallback(() => {
    if (!user) return;
    checkAndAward(user.id, "joueur", user.categorie, user.prenom, user.nom, (ids) => {
      setNewBadgeIds(ids);
      setHasBadges(true);
    });
  }, [user, checkAndAward]);

  // Une carte Victorinis par NOUVEL enregistrement (pas à la modification)
  const handleNewEntry = useCallback(() => {
    if (!user?.victorinis) return;
    tirerCarte(user.id, "joueur").then((c) => {
      if (!c) return;
      setCarteGagnee(c);
      setCartesRefresh((n) => n + 1);
    });
  }, [user]);

  // Récompenses des enregistrements faits hors ligne, distribuées après l'envoi
  useEffect(() => {
    if (!user) return;
    const distribute = () => {
      const n = consumePendingRewards(user.id);
      if (!n) return;
      handleSave();
      for (let i = 0; i < n; i++) handleNewEntry();
    };
    distribute();
    window.addEventListener(SYNC_EVENT, distribute);
    return () => window.removeEventListener(SYNC_EVENT, distribute);
  }, [user?.id, handleSave, handleNewEntry]);

  const handlePhoneUpdated = (newPhone: string) => {
    setTelephone(newPhone);
    updateSessionUser({ numero_tel: newPhone });
  };

  const Spinner = () => (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
      <div
        className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }}
      />
    </div>
  );

  if (!user || !badgesChecked) return <Spinner />;

  const isMasculin = user.categorie === "Masculin";
  const pole: "masculin" | "feminin" = isMasculin ? "masculin" : "feminin";
  const BASE_TABS = ALL_BASE_TABS.filter((t) => t.id !== "billets" || hasBillets);
  const tabs = [
    ...BASE_TABS,
    ...(isMasculin ? [TAB_MENTALE] : []),
    ...(user.victorinis ? [TAB_VICTORINIS] : []),
    TAB_TOURNOIS,
    ...(user.acces_jeux ? [TAB_JEUX] : []),
    ...(hasCarte ? [TAB_CARTE] : []),
    ...(hasBadges ? [TAB_BADGES] : []),
    ...(hasQuestionnaire ? [TAB_QUESTIONNAIRE] : []),
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
        role="player"
        pole={pole}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onPhoneUpdated={handlePhoneUpdated}
        theme="joueur"
      >
        {activeTab === "billets" && <Billets userId={user.id} />}
        {activeTab === "sportif" && <SuiviSportif userId={user.id} onSave={handleSave} onCreate={handleNewEntry} />}
        {activeTab === "forme" && <SuiviForme userId={user.id} onSave={handleSave} onCreate={handleNewEntry} />}
        {activeTab === "mentale" && isMasculin && <PreparationMentale userId={user.id} onSave={handleSave} onCreate={handleNewEntry} />}
        {activeTab === "victorinis" && user.victorinis && (
          <VictorinisTab userId={user.id} userType="joueur" refreshKey={cartesRefresh} />
        )}
        {activeTab === "tournois" && <Tournois />}
        {activeTab === "jeux" && user.acces_jeux && <GamesTab />}
        {activeTab === "carte" && <CarteAvantage userId={user.id} />}
        {activeTab === "badges" && <BadgesTab userId={user.id} userType="joueur" categorie={user.categorie} />}
        {activeTab === "questionnaire" && <QuestionnaireTab userId={user.id} />}
      </Layout>

      <PwaBanner />

      {/* Modal notifications — s'affiche à chaque connexion si pas encore inscrit en base */}
      <NotificationsPrompt userId={user.id} role="player" pole={pole} />

      {/* Notifs reçues depuis la dernière connexion */}
      <NotificationsInbox userId={user.id} role="player" pole={pole} />

      {newBadgeIds.length > 0 && (
        <BadgePopup badgeIds={newBadgeIds} onDone={() => setNewBadgeIds([])} categorie={user.categorie} />
      )}

      {notifId && <NotifModal notifId={notifId} onClose={() => setNotifId(null)} />}

      {carteGagnee && (
        <CarteModal personne={carteGagnee.personne} rarete={carteGagnee.rarete} onClose={() => setCarteGagnee(null)} />
      )}
    </>
  );
}
