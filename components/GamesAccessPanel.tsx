"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

interface JoueuseAcces {
  id: string;
  prenom: string;
  nom: string;
  categorie?: string;
  acces_jeux: boolean;
}

type PoleFilter = "tous" | "masculin" | "feminin";

export default function GamesAccessPanel() {
  const [joueurs, setJoueurs] = useState<JoueuseAcces[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [poleFilter, setPoleFilter] = useState<PoleFilter>("tous");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("joueuses")
      .select("id, prenom, nom, categorie, acces_jeux")
      .order("prenom", { ascending: true });
    if (error) {
      setFeedback({ type: "error", msg: "Erreur de chargement : " + error.message });
    }
    setJoueurs(
      (data ?? []).map((j: Omit<JoueuseAcces, "acces_jeux"> & { acces_jeux: boolean | null }) => ({
        ...j,
        acces_jeux: !!j.acces_jeux,
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const showFeedback = (type: "success" | "error", msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 2500);
  };

  const toggleAccess = async (j: JoueuseAcces) => {
    setSavingId(j.id);
    const next = !j.acces_jeux;
    const { error } = await supabase.from("joueuses").update({ acces_jeux: next }).eq("id", j.id);
    setSavingId(null);
    if (error) {
      showFeedback("error", "Erreur lors de la mise à jour.");
      return;
    }
    setJoueurs((prev) => prev.map((p) => (p.id === j.id ? { ...p, acces_jeux: next } : p)));
    showFeedback("success", next ? `${j.prenom} a maintenant accès aux jeux.` : `Accès retiré à ${j.prenom}.`);
  };

  const filtered = joueurs
    .filter((j) => `${j.prenom} ${j.nom}`.toLowerCase().includes(search.toLowerCase()))
    .filter((j) => {
      if (poleFilter === "masculin") return j.categorie === "Masculin";
      if (poleFilter === "feminin") return j.categorie === "Féminin";
      return true;
    });

  const activesCount = joueurs.filter((j) => j.acces_jeux).length;

  return (
    <div className="space-y-4">
      {feedback && (
        <div
          className="rounded-xl px-4 py-3 text-sm font-medium"
          style={{
            background: feedback.type === "success" ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
            border: `1px solid ${feedback.type === "success" ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)"}`,
            color: feedback.type === "success" ? "#4ade80" : "#f87171",
          }}
        >
          {feedback.msg}
        </div>
      )}

      <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
        <p className="text-xs uppercase tracking-widest font-medium mb-1" style={{ color: "var(--text-sub)" }}>
          Accès à la section Jeux
        </p>
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          Par défaut, seuls les joueurs du pôle masculin y ont accès. Active ou
          désactive l&apos;accès individuellement ci-dessous ; le changement est
          effectif immédiatement.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs uppercase tracking-widest font-medium" style={{ color: "var(--text-sub)" }}>
          {activesCount} / {joueurs.length} avec accès
        </p>
        <div className="flex gap-2">
          {(["tous", "masculin", "feminin"] as PoleFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setPoleFilter(f)}
              className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all"
              style={{
                background:
                  poleFilter === f ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "var(--bg-input)",
                border: `1px solid ${poleFilter === f ? "var(--accent)" : "var(--border)"}`,
                color: poleFilter === f ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              {f === "tous" ? "Tous" : f === "masculin" ? "♂ Masc" : "♀ Fém"}
            </button>
          ))}
        </div>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Rechercher un joueur…"
        className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
        style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)" }}
      />

      {loading ? (
        <div className="flex justify-center py-8">
          <div
            className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }}
          />
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          {filtered.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>
              Aucun joueur trouvé.
            </p>
          ) : (
            filtered.map((j, i) => (
              <div
                key={j.id}
                className="flex items-center gap-3 px-4 py-3"
                style={{
                  background: "var(--bg-card)",
                  borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none",
                }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
                    {j.prenom} {j.nom}
                  </p>
                  {j.categorie && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full inline-block mt-0.5"
                      style={{
                        background:
                          j.categorie === "Masculin" ? "rgba(59,130,246,0.12)" : "rgba(236,72,153,0.12)",
                        color: j.categorie === "Masculin" ? "#60a5fa" : "#f472b6",
                      }}
                    >
                      {j.categorie === "Masculin" ? "M" : "F"}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => toggleAccess(j)}
                  disabled={savingId === j.id}
                  className="flex items-center gap-2 shrink-0 disabled:opacity-50"
                >
                  <span
                    className="text-xs font-medium whitespace-nowrap"
                    style={{ color: j.acces_jeux ? "#4ade80" : "var(--text-muted)" }}
                  >
                    {j.acces_jeux ? "Accès activé" : "Aucun accès"}
                  </span>
                  <div
                    className="w-10 h-5 rounded-full relative transition-colors shrink-0"
                    style={{ background: j.acces_jeux ? "var(--accent)" : "var(--border)" }}
                  >
                    <div
                      className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                      style={{ left: j.acces_jeux ? "calc(100% - 18px)" : "2px" }}
                    />
                  </div>
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
