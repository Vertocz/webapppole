"use client";

// Onglet « Analyse vidéo » du staff du pôle masculin : liste des matchs,
// création, tagging de la vidéo, stats du match et évolution.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Joueuse } from "@/types";
import Card from "@/components/Card";
import { Spinner } from "@/components/ui";
import { type Action, type Match, score } from "@/lib/analyse";
import MatchModal from "./MatchModal";
import TaggingScreen from "./TaggingScreen";
import RapportMatch, { dateMatch, titreMatch } from "./RapportMatch";
import Evolution from "./Evolution";

type Ecran = { id: string; vue: "tagging" | "rapport" } | null;

function nbActions(acts: Action[]) {
  const r = acts.filter((a) => a.type === "repere").length;
  const n = acts.length - r;
  return `${n} action${n > 1 ? "s" : ""}${r ? ` · ${r} repère${r > 1 ? "s" : ""}` : ""}`;
}

export default function AnalyseVideoTab({ joueurs, staffId }: { joueurs: Joueuse[]; staffId: string }) {
  const [matchs, setMatchs] = useState<Match[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [onglet, setOnglet] = useState<"matchs" | "evolution">("matchs");
  const [ecran, setEcran] = useState<Ecran>(null);
  const [modale, setModale] = useState<{ existant?: Match } | null>(null);
  const [aSupprimer, setASupprimer] = useState<string | null>(null);
  // Vidéo choisie par match, gardée le temps de la session (aller-retour tagging ↔ stats)
  const [fichiers, setFichiers] = useState<Record<string, File>>({});

  const joueursMasc = useMemo(() => joueurs.filter((j) => j.categorie === "Masculin"), [joueurs]);

  const charger = useCallback(async () => {
    const { data, error } = await supabase
      .from("analyse_matchs")
      .select("*")
      .eq("pole", "masculin")
      .order("date_match", { ascending: false });
    if (error) {
      setErreur(
        error.code === "42P01" || error.code === "PGRST205"
          ? "Les tables de l'analyse vidéo n'existent pas encore. Exécute le fichier sql/analyse_video.sql dans Supabase > SQL Editor."
          : "Impossible de charger les matchs. Vérifie la connexion.",
      );
      setChargement(false);
      return;
    }
    const liste = (data ?? []) as Match[];
    setMatchs(liste);
    if (liste.length) {
      const { data: acts } = await supabase
        .from("analyse_actions")
        .select("*")
        .in("match_id", liste.map((m) => m.id));
      setActions((acts ?? []) as Action[]);
    } else setActions([]);
    setErreur(null);
    setChargement(false);
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const matchOuvert = ecran ? matchs.find((m) => m.id === ecran.id) ?? null : null;

  const majLocale = (m: Match) => setMatchs((liste) => liste.map((x) => (x.id === m.id ? m : x)));

  const supprimer = async (id: string) => {
    const { error } = await supabase.from("analyse_matchs").delete().eq("id", id);
    setASupprimer(null);
    if (error) { setErreur("Suppression impossible. Vérifie la connexion."); return; }
    setMatchs((l) => l.filter((m) => m.id !== id));
    setActions((l) => l.filter((a) => a.match_id !== id));
  };

  if (matchOuvert && ecran?.vue === "rapport") {
    return (
      <RapportMatch
        match={matchOuvert}
        joueurs={joueursMasc}
        onFermer={() => { setEcran(null); charger(); }}
        onTaguer={() => setEcran({ id: matchOuvert.id, vue: "tagging" })}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1 p-1 rounded-xl w-max" style={{ background: "rgba(255,255,255,0.04)" }}>
        {([["matchs", "Matchs"], ["evolution", "Évolution"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setOnglet(id)}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
            style={{
              background: onglet === id ? "var(--primary)" : "transparent",
              color: onglet === id ? "white" : "var(--text-muted)",
              boxShadow: onglet === id ? "0 2px 8px rgba(30,58,110,0.4)" : "none",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {erreur && (
        <p className="text-sm rounded-lg px-4 py-3" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5" }}>
          {erreur}
        </p>
      )}

      {chargement ? <Spinner /> : onglet === "evolution" ? (
        <Evolution matchs={matchs} actions={actions} joueurs={joueursMasc} />
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl leading-none court-line" style={{ color: "var(--text-main)" }}>Analyse vidéo</h2>
                <p className="text-xs mt-2" style={{ color: "var(--text-sub)" }}>
                  Crée le match, ouvre la vidéo depuis ton PC et tague les actions. Les stats se calculent toutes seules.
                </p>
              </div>
              <button
                onClick={() => setModale({})}
                className="hover-lift px-4 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white", boxShadow: "0 2px 12px var(--accent-glow)" }}
              >
                + Nouveau match
              </button>
            </div>
          </Card>

          {matchs.length === 0 && !erreur && (
            <Card>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Aucun match pour l&apos;instant. Commence par « Nouveau match » : date, adversaire et les 4 joueurs.
              </p>
            </Card>
          )}

          <div className="space-y-3">
            {matchs.map((m) => {
              const acts = actions.filter((a) => a.match_id === m.id);
              const sc = score(acts);
              const noms = m.effectif.map((id) => joueursMasc.find((j) => j.id === id)?.prenom ?? "?").join(", ");
              return (
                <Card key={m.id} className="p-4!">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p style={{ fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-sub)" }}>
                        {dateMatch(m)}{m.competition ? ` · ${m.competition}` : ""}
                      </p>
                      <p className="font-display text-2xl leading-tight truncate" style={{ color: "var(--text-main)" }}>{titreMatch(m)}</p>
                      <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{noms} · {nbActions(acts)}</p>
                    </div>
                    <p className="font-display text-3xl" style={{ fontVariantNumeric: "tabular-nums" }}>
                      <span style={{ color: "var(--accent)" }}>{sc.nous}</span>
                      <span style={{ color: "var(--text-muted)" }}> – </span>
                      <span style={{ color: "var(--text-main)" }}>{m.mode_adversaire === "aucun" ? "?" : sc.adversaire}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <button
                      onClick={() => setEcran({ id: m.id, vue: "tagging" })}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                      style={{ background: "var(--primary)", color: "white" }}
                    >
                      ▶ Taguer la vidéo
                    </button>
                    <button
                      onClick={() => setEcran({ id: m.id, vue: "rapport" })}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium"
                      style={{ background: "color-mix(in srgb,var(--accent) 12%,transparent)", border: "1px solid color-mix(in srgb,var(--accent) 30%,transparent)", color: "var(--accent)" }}
                    >
                      Stats du match
                    </button>
                    <button onClick={() => setModale({ existant: m })} className="hover-text-main px-3 py-1.5 rounded-lg text-xs" style={{ border: "1px solid var(--border)", color: "var(--text-sub)" }}>
                      Modifier
                    </button>
                    <span className="ml-auto">
                      {aSupprimer === m.id ? (
                        <span className="flex items-center gap-2 text-xs" style={{ color: "#fca5a5" }}>
                          Supprimer le match et ses actions ?
                          <button onClick={() => supprimer(m.id)} className="px-2 py-1 rounded-md font-semibold" style={{ background: "#b91c1c", color: "white" }}>Oui</button>
                          <button onClick={() => setASupprimer(null)} className="px-2 py-1 rounded-md" style={{ border: "1px solid var(--border)", color: "var(--text-sub)" }}>Non</button>
                        </span>
                      ) : (
                        <button onClick={() => setASupprimer(m.id)} className="icon-btn icon-btn-danger w-8 h-8 rounded-lg text-xs" aria-label="Supprimer le match" title="Supprimer">🗑</button>
                      )}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {modale && (
        <MatchModal
          joueurs={joueursMasc}
          staffId={staffId}
          existant={modale.existant}
          onFermer={() => setModale(null)}
          onEnregistre={(m, nouveau) => {
            setModale(null);
            if (nouveau) { setMatchs((l) => [m, ...l].sort((a, b) => b.date_match.localeCompare(a.date_match))); setEcran({ id: m.id, vue: "tagging" }); }
            else majLocale(m);
          }}
        />
      )}

      {matchOuvert && ecran?.vue === "tagging" && (
        <TaggingScreen
          match={matchOuvert}
          joueurs={joueursMasc}
          onFermer={() => { setEcran(null); charger(); }}
          onMatchModifie={majLocale}
          fichierInitial={fichiers[matchOuvert.id]}
          onFichier={(f) => setFichiers((x) => ({ ...x, [matchOuvert.id]: f }))}
          onVoirRapport={() => setEcran({ id: matchOuvert.id, vue: "rapport" })}
        />
      )}
    </div>
  );
}
