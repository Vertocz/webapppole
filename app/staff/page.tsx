"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import ThemeProvider from "@/components/ThemeProvider";
import SuiviSportif from "@/components/SuiviSportif";
import SuiviForme from "@/components/SuiviForme";
import PreparationMentale from "@/components/PreparationMentale";
import Billets from "@/components/Billets";
import Tournois from "@/components/Tournois";
import GaresLogistique from "@/components/GaresLogistique";
import BadgesTab from "@/components/BadgesTab";
import BadgePopup from "@/components/BadgePopup";
import ProfilModal from "@/components/ProfilModal";
import ExportPDFModal from "@/components/ExportPDFModal";
import NotificationsPrompt from "@/components/NotificationsPrompt";
import NotificationsInbox from "@/components/NotificationsInbox";
import { useBadges } from "@/lib/useBadges";
import Card from "@/components/Card";
import type { Staff, Joueuse } from "@/types";
import PwaBanner from "@/components/PwaBanner";

export default function StaffPage() {
  const [user,           setUser]           = useState<Staff | null>(null);
  const [joueurs,        setJoueurs]        = useState<Joueuse[]>([]);
  const [selectedJoueur, setSelectedJoueur] = useState<Joueuse | null>(null);
  const [ongletActif,    setOngletActif]    = useState("sportif");
  const [loadingJoueurs, setLoadingJoueurs] = useState(true);
  const [view, setView] = useState<"billets"|"joueurs"|"tournois"|"gares">("joueurs");
  const [hasBillets,     setHasBillets]     = useState(false);
  const [newBadgeIds,    setNewBadgeIds]    = useState<string[]>([]);
  const [badgesChecked,  setBadgesChecked]  = useState(false);
  const [telephone,      setTelephone]      = useState("");
  const [profilOpen,     setProfilOpen]     = useState(false);
  const [exportOpen,     setExportOpen]     = useState(false);
  const { checkAndAward } = useBadges();
  const router = useRouter();

  // Onglets dynamiques selon la catégorie du joueur sélectionné
  const ongletsJoueur = [
    { id: "sportif", label: "Suivi sportif",  icon: "⛹️‍♀️" },
    { id: "forme",   label: "Forme",          icon: "🧘‍♀️" },
    ...(selectedJoueur?.categorie === "Masculin"
      ? [{ id: "mentale", label: "Prépa mentale", icon: "🧠" }]
      : []),
    { id: "badges",  label: "Badges",         icon: "🏅" },
  ];

  useEffect(() => {
    const stored = sessionStorage.getItem("user");
    const type   = sessionStorage.getItem("type_user");
    if (!stored || type !== "staff") { router.push("/"); return; }
    const u = JSON.parse(stored) as Staff;
    setUser(u);
    setTelephone(u.numero_tel ?? "");

    // Le staff n'a plus de badges — on passe juste badgesChecked à true
    setBadgesChecked(true);
    checkAndAward(u.id, "staff", undefined, u.prenom, u.nom, () => {});

    supabase.from("billets").select("id").eq("joueuse_id", u.id).limit(1)
      .then(({ data }) => {
        const has = (data ?? []).length > 0;
        setHasBillets(has);
        if (has) setView("billets");
      });

    const loadJoueurs = async () => {
      let query = supabase.from("joueuses").select("id, prenom, nom, numero_tel, categorie");
      if (u.masculin && !u.feminin)      query = query.eq("categorie", "Masculin");
      else if (u.feminin && !u.masculin) query = query.eq("categorie", "Féminin");
      const { data } = await query.order("prenom", { ascending: true });
      setJoueurs(data ?? []);
      if (data && data.length > 0) setSelectedJoueur(data[0]);
      setLoadingJoueurs(false);
    };
    loadJoueurs();
  }, [router, checkAndAward]);

  const handlePhoneUpdated = (newPhone: string) => {
    setTelephone(newPhone);
    const stored = sessionStorage.getItem("user");
    if (stored) {
      const parsed = JSON.parse(stored);
      parsed.numero_tel = newPhone;
      sessionStorage.setItem("user", JSON.stringify(parsed));
    }
  };

  const handleSelectJoueur = (j: Joueuse) => {
    setSelectedJoueur(j);
    // Si on était sur "mentale" et qu'on passe sur une joueuse féminine → reset
    if (ongletActif === "mentale" && j.categorie !== "Masculin") {
      setOngletActif("sportif");
    }
  };

  const pole: "masculin" | "feminin" | "both" = !user ? "both"
    : user.masculin && user.feminin ? "both"
    : user.masculin ? "masculin"
    : "feminin";

  if (!user || !badgesChecked) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
    </div>
  );

  const AUTHORIZED_PHONE = "0630358954";
  const isLogisticien = user.numero_tel === AUTHORIZED_PHONE;

  const viewTabs = [
    ...(hasBillets ? [{ id: "billets",  label: "Mes billets",  icon: "🎫" }] : []),
    { id: "joueurs",  label: "Suivi joueurs", icon: "📊" },
    { id: "tournois", label: "Tournois",       icon: "🏆" },
    ...(isLogisticien ? [{ id: "gares", label: "Gares", icon: "🚉" }] : []),
  ];

  return (
    <>
      <ThemeProvider theme="staff" />
      <div className="relative min-h-screen z-10">

        <div className="h-0.5 w-full"
          style={{ background: "linear-gradient(90deg,var(--primary),var(--accent),var(--primary))" }} />

        <header className="sticky top-0 z-50 px-4 py-3"
          style={{ background: "color-mix(in srgb, var(--bg-base) 92%, transparent)",
            backdropFilter: "blur(14px)", borderBottom: "1px solid var(--border)" }}>
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0" style={{ background: "white", padding: "3px" }}>
                <Image src="/logo.png" alt="Logo" width={30} height={30} style={{ objectFit: "contain" }} />
              </div>
              <div>
                <p className="font-display text-base leading-none" style={{ color: "var(--text-main)" }}>PÔLE FRANCE</p>
                <p className="text-[10px] tracking-widest uppercase font-light" style={{ color: "var(--text-sub)" }}>PARA BASKETBALL ADAPTE</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => router.push("/staff/admin")}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-95"
                style={{
                  background: "color-mix(in srgb,var(--accent) 12%,transparent)",
                  border: "1px solid color-mix(in srgb,var(--accent) 30%,transparent)",
                  color: "var(--accent)",
                }}>
                ⚙️ Admin
              </button>
              <button onClick={() => setProfilOpen(true)} className="text-right transition-opacity hover:opacity-70">
                <p className="text-xs uppercase tracking-widest font-light" style={{ color: "var(--text-sub)" }}>Staff</p>
                <p className="text-sm font-medium underline decoration-dotted underline-offset-2"
                  style={{ color: "var(--text-main)", textDecorationColor: "var(--border)" }}>
                  {user.prenom}
                </p>
              </button>
              <button
                onClick={() => { sessionStorage.clear(); router.push("/"); }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ border: "1px solid var(--border)", color: "var(--text-sub)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "var(--text-main)")}
                onMouseLeave={e => (e.currentTarget.style.color = "var(--text-sub)")}>
                Déconnexion
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">

          <div className="overflow-x-auto scrollbar-hide -mx-4 px-4">
            <div className="flex rounded-xl p-1 gap-1 w-max min-w-full"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
              {viewTabs.map(v => (
                <button key={v.id}
                  onClick={() => setView(v.id as typeof view)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap"
                  style={view === v.id
                    ? { background: "linear-gradient(135deg,var(--accent),var(--accent2))",
                        color: "white", boxShadow: "0 2px 12px var(--accent-glow)" }
                    : { color: "var(--text-muted)" }}>
                  <span>{v.icon}</span><span>{v.label}</span>
                </button>
              ))}
            </div>
          </div>

          {view === "billets"  && <Billets userId={user.id} />}
          {view === "tournois" && <Tournois />}
          {view === "gares"    && <GaresLogistique />}

          {view === "joueurs" && (
            <div className="space-y-5">
              <Card>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <label style={{ fontSize:"0.7rem", fontWeight:500, letterSpacing:"0.12em",
                    textTransform:"uppercase", color:"var(--text-sub)" }}>
                    Joueur / Joueuse
                  </label>
                  {joueurs.length > 0 && (
                    <button onClick={() => setExportOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80 active:scale-95"
                      style={{ background: "rgba(196,154,40,0.12)", border: "1px solid rgba(196,154,40,0.3)", color: "#C49A28" }}>
                      <span>📄</span><span>Export PDF</span>
                    </button>
                  )}
                </div>

                {loadingJoueurs ? (
                  <div className="flex items-center gap-2 py-2" style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                    <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
                      style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
                    Chargement...
                  </div>
                ) : joueurs.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>Aucun joueur trouvé.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {joueurs.map(j => {
                      const isSelected = selectedJoueur?.id === j.id;
                      return (
                        <button key={j.id} onClick={() => handleSelectJoueur(j)}
                          className="px-3 py-2 rounded-xl text-sm font-medium transition-all"
                          style={{
                            background: isSelected ? "color-mix(in srgb, var(--accent) 15%, var(--bg-card))" : "var(--bg-input)",
                            border: isSelected ? "1px solid color-mix(in srgb, var(--accent) 40%, transparent)" : "1px solid var(--border)",
                            color: isSelected ? "var(--text-main)" : "var(--text-muted)",
                          }}>
                          {j.prenom} {j.nom}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>

              {selectedJoueur && (
                <div className="animate-fade-in-up" key={selectedJoueur.id}>
                  <div className="flex overflow-x-auto scrollbar-hide border-b mb-5" style={{ borderColor: "var(--border)" }}>
                    {ongletsJoueur.map(ong => (
                      <button key={ong.id} onClick={() => setOngletActif(ong.id)}
                        className="flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap transition-all"
                        style={{
                          color: ongletActif === ong.id ? "var(--tab-active)" : "var(--text-muted)",
                          borderBottom: ongletActif === ong.id ? "2px solid var(--tab-active)" : "2px solid transparent",
                          marginBottom: "-1px",
                        }}>
                        <span>{ong.icon}</span><span>{ong.label}</span>
                      </button>
                    ))}
                  </div>
                  {ongletActif === "sportif"  && <SuiviSportif userId={selectedJoueur.id} readOnly />}
                  {ongletActif === "forme"    && <SuiviForme userId={selectedJoueur.id} readOnly />}
                  {ongletActif === "mentale"  && selectedJoueur.categorie === "Masculin" && <PreparationMentale userId={selectedJoueur.id} readOnly />}
                  {ongletActif === "badges"   && (
                    <BadgesTab userId={selectedJoueur.id} userType="joueur"
                      categorie={selectedJoueur.categorie} readOnly />
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      <PwaBanner />

      <NotificationsPrompt userId={user.id} role="staff" pole={pole} />

      {/* Notifs reçues depuis la dernière connexion */}
      <NotificationsInbox userId={user.id} role="staff" pole={pole} />

      {newBadgeIds.length > 0 && (
        <BadgePopup badgeIds={newBadgeIds} onDone={() => setNewBadgeIds([])} />
      )}

      {profilOpen && user && (
        <ProfilModal
          role="staff"
          pole={pole}
          userId={user.id}
          userType="staff"
          prenom={user.prenom}
          nom={user.nom}
          telephone={telephone}
          onClose={() => setProfilOpen(false)}
          onPhoneUpdated={(newPhone) => { handlePhoneUpdated(newPhone); setProfilOpen(false); }}
        />
      )}

      {exportOpen && (
        <ExportPDFModal joueurs={joueurs} onClose={() => setExportOpen(false)} />
      )}
    </>
  );
}