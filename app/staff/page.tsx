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
import Card from "@/components/Card";
import type { Staff, Joueuse } from "@/types";

const ONGLETS_JOUEUR = [
  { id: "sportif", label: "Suivi sportif",    icon: "⛹️‍♀️" },
  { id: "forme",   label: "Forme",            icon: "🧘‍♀️" },
  { id: "mentale", label: "Prépa mentale",    icon: "🧠" },
];

export default function StaffPage() {
  const [user, setUser] = useState<Staff | null>(null);
  const [joueurs, setJoueurs] = useState<Joueuse[]>([]);
  const [selectedJoueur, setSelectedJoueur] = useState<Joueuse | null>(null);
  const [ongletActif, setOngletActif] = useState<string>("sportif");
  const [loadingJoueurs, setLoadingJoueurs] = useState(true);
  const [view, setView] = useState<"billets" | "joueurs">("billets");
  const router = useRouter();

  useEffect(() => {
    const stored = sessionStorage.getItem("user");
    const type = sessionStorage.getItem("type_user");
    if (!stored || type !== "staff") { router.push("/"); return; }
    const u = JSON.parse(stored) as Staff;
    setUser(u);

    // Charger la liste des joueurs
    const loadJoueurs = async () => {
      let query = supabase.from("joueuses").select("id, prenom, nom, categorie");
      if (u.masculin && !u.feminin) query = query.eq("categorie", "Masculin");
      else if (u.feminin && !u.masculin) query = query.eq("categorie", "Féminin");
      const { data } = await query.order("prenom", { ascending: true });
      setJoueurs(data ?? []);
      if (data && data.length > 0) setSelectedJoueur(data[0]);
      setLoadingJoueurs(false);
    };
    loadJoueurs();
  }, [router]);

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <>
      <ThemeProvider theme="staff" />
      <div className="relative min-h-screen z-10">
        {/* Stripe top */}
        <div className="h-0.5 w-full" style={{ background: "linear-gradient(90deg, var(--primary), var(--accent), var(--primary))" }} />

        {/* Header */}
        <header className="sticky top-0 z-50 px-4 py-3" style={{ background: "color-mix(in srgb, var(--bg-base) 92%, transparent)", backdropFilter: "blur(14px)", borderBottom: "1px solid var(--border)" }}>
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0" style={{ background: "white", padding: "3px" }}>
                <Image src="/logo.png" alt="Logo" width={30} height={30} style={{ objectFit: "contain" }} />
              </div>
              <div>
                <p className="font-display text-base leading-none" style={{ color: "var(--text-main)" }}>PÔLE FRANCE</p>
                <p className="text-[10px] tracking-widest uppercase font-light" style={{ color: "var(--text-sub)" }}>Staff</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium hidden sm:block" style={{ color: "var(--text-main)" }}>{user.prenom} {user.nom}</span>
              <button onClick={() => { sessionStorage.clear(); router.push("/"); }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ border: "1px solid var(--border)", color: "var(--text-sub)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-main)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-sub)")}>
                Déconnexion
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
          {/* Vue principale : Mes billets ou Suivi joueurs */}
          <div className="flex rounded-xl p-1 gap-1" style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
            {[
              { id: "billets", label: "Mes billets", icon: "🎫" },
              { id: "joueurs", label: "Suivi joueurs", icon: "📊" },
            ].map((v) => (
              <button key={v.id} onClick={() => setView(v.id as "billets" | "joueurs")}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all"
                style={view === v.id
                  ? { background: "linear-gradient(135deg, var(--accent), var(--accent2))", color: "white", boxShadow: "0 2px 12px var(--accent-glow)" }
                  : { color: "var(--text-muted)" }}>
                <span>{v.icon}</span><span>{v.label}</span>
              </button>
            ))}
          </div>

          {/* Mes billets */}
          {view === "billets" && <Billets userId={user.id} />}

          {/* Suivi joueurs */}
          {view === "joueurs" && (
            <div className="space-y-5">
              {/* Sélecteur joueur */}
              <Card>
                <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-sub)", marginBottom: "0.5rem" }}>
                  Joueur / Joueuse
                </label>
                {loadingJoueurs ? (
                  <div className="flex items-center gap-2 py-2" style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                    <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
                    Chargement...
                  </div>
                ) : joueurs.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>Aucun joueur trouvé.</p>
                ) : (
                  /* Grille cliquable de joueurs */
                  <div className="flex flex-wrap gap-2">
                    {joueurs.map((j) => {
                      const isSelected = selectedJoueur?.id === j.id;
                      return (
                        <button key={j.id} onClick={() => setSelectedJoueur(j)}
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

              {/* Onglets du joueur sélectionné */}
              {selectedJoueur && (
                <div className="animate-fade-in-up" key={selectedJoueur.id}>
                  {/* Sous-navigation */}
                  <div className="flex border-b mb-5" style={{ borderColor: "var(--border)" }}>
                    {ONGLETS_JOUEUR.map((ong) => (
                      <button key={ong.id} onClick={() => setOngletActif(ong.id)}
                        className="flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap transition-all"
                        style={{
                          color: ongletActif === ong.id ? "var(--tab-active)" : "var(--text-muted)",
                          borderBottom: ongletActif === ong.id ? "2px solid var(--tab-active)" : "2px solid transparent",
                          marginBottom: "-1px",
                        }}>
                        <span>{ong.icon}</span>
                        <span>{ong.label}</span>
                      </button>
                    ))}
                  </div>

                  {ongletActif === "sportif"  && <SuiviSportif userId={selectedJoueur.id} readOnly />}
                  {ongletActif === "forme"    && <SuiviForme userId={selectedJoueur.id} readOnly />}
                  {ongletActif === "mentale"  && <PreparationMentale userId={selectedJoueur.id} readOnly />}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
