"use client";

// Création ou modification d'un match : date, adversaire, 4 joueurs, tirs adverses.

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Joueuse } from "@/types";
import { todayISO } from "@/lib/dates";
import { fieldInputStyle, fieldLabelStyle } from "@/components/ui";
import { type Match, type ModeAdversaire, nouvelId } from "@/lib/analyse";

const MODES: { id: ModeAdversaire; label: string; info: string }[] = [
  { id: "simple", label: "Tirs et rebonds adverses", info: "Qui tire, 1 pt / 2 pts / LF, sans position. Donne le score et déduit les rebonds." },
  { id: "position", label: "Comme pour nous", info: "Tirs adverses avec leur position sur le terrain." },
  { id: "aucun", label: "Rien côté adversaire", info: "Plus rapide. Pas de score adverse ; les rebonds se précisent à la main." },
];

export default function MatchModal({
  joueurs, staffId, existant, onFermer, onEnregistre,
}: {
  joueurs: Joueuse[];
  staffId: string;
  existant?: Match;
  onFermer: () => void;
  onEnregistre: (m: Match, nouveau: boolean) => void;
}) {
  const [date, setDate] = useState(existant?.date_match ?? todayISO());
  const [adversaire, setAdversaire] = useState(existant?.adversaire ?? "");
  const [competition, setCompetition] = useState(existant?.competition ?? "");
  const [effectif, setEffectif] = useState<string[]>(existant?.effectif ?? []);
  const [mode, setMode] = useState<ModeAdversaire>(existant?.mode_adversaire ?? "simple");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const basculer = (id: string) =>
    setEffectif((e) => (e.includes(id) ? e.filter((x) => x !== id) : e.length >= 4 ? e : [...e, id]));

  const valide = !!date && effectif.length >= 3;

  const enregistrer = async () => {
    if (!valide) return;
    setEnvoi(true); setErreur(null);
    const champs = {
      date_match: date,
      adversaire: adversaire.trim() || null,
      competition: competition.trim() || null,
      effectif,
      mode_adversaire: mode,
    };
    if (existant) {
      const { error } = await supabase.from("analyse_matchs").update({ ...champs, modifie_le: new Date().toISOString() }).eq("id", existant.id);
      setEnvoi(false);
      if (error) { setErreur("Enregistrement impossible. Vérifie la connexion."); return; }
      onEnregistre({ ...existant, ...champs }, false);
      return;
    }
    const m: Match = {
      id: nouvelId(), pole: "masculin", ...champs,
      video_nom: null, video_taille: null, video_debut: 0, calibration: null, cree_par: staffId,
    };
    const { error } = await supabase.from("analyse_matchs").insert(m);
    setEnvoi(false);
    if (error) {
      setErreur(
        error.code === "42P01" || error.code === "PGRST205"
          ? "Les tables de l'analyse vidéo n'existent pas encore : exécute sql/analyse_video.sql dans Supabase."
          : "Enregistrement impossible. Vérifie la connexion.",
      );
      return;
    }
    onEnregistre(m, true);
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4"
      style={{ background: "rgba(3,5,10,0.72)", backdropFilter: "blur(3px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onFermer(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={existant ? "Modifier le match" : "Nouveau match"}
        className="w-full max-w-lg rounded-2xl p-5 space-y-5 max-h-[92vh] overflow-y-auto animate-fade-in-up"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}
      >
        <h2 className="font-display text-3xl leading-none court-line" style={{ color: "var(--text-main)" }}>
          {existant ? "Modifier le match" : "Nouveau match"}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="analyse-date" style={fieldLabelStyle}>Date</label>
            <input id="analyse-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-sm" style={fieldInputStyle} />
          </div>
          <div>
            <label htmlFor="analyse-adversaire" style={fieldLabelStyle}>Adversaire</label>
            <input id="analyse-adversaire" value={adversaire} onChange={(e) => setAdversaire(e.target.value)} placeholder="ex. Australie" className="w-full rounded-lg px-3 py-2.5 text-sm" style={fieldInputStyle} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="analyse-competition" style={fieldLabelStyle}>Compétition (facultatif)</label>
            <input id="analyse-competition" value={competition} onChange={(e) => setCompetition(e.target.value)} placeholder="ex. Virtus Asia-Oceania, Bangkok" className="w-full rounded-lg px-3 py-2.5 text-sm" style={fieldInputStyle} />
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <span style={fieldLabelStyle}>Les 4 joueurs du match</span>
            <span className="text-xs" style={{ color: effectif.length === 4 ? "var(--accent)" : "var(--text-muted)" }}>{effectif.length}/4</span>
          </div>
          {joueurs.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>Aucun joueur du pôle masculin trouvé.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {joueurs.map((j) => {
                const sel = effectif.includes(j.id);
                const plein = !sel && effectif.length >= 4;
                return (
                  <button
                    key={j.id}
                    onClick={() => basculer(j.id)}
                    disabled={plein}
                    className="px-3 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-35"
                    style={{
                      background: sel ? "color-mix(in srgb, var(--accent) 15%, var(--bg-card))" : "var(--bg-input)",
                      border: sel ? "1px solid color-mix(in srgb, var(--accent) 40%, transparent)" : "1px solid var(--border)",
                      color: sel ? "var(--text-main)" : "var(--text-muted)",
                    }}
                  >
                    {j.prenom} {j.nom}
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>3 au minimum si un joueur manque.</p>
        </div>

        <fieldset>
          <legend style={fieldLabelStyle}>Côté adversaire</legend>
          <div className="space-y-2">
            {MODES.map((m) => (
              <label
                key={m.id}
                className="flex gap-3 p-3 rounded-xl cursor-pointer"
                style={{
                  background: mode === m.id ? "color-mix(in srgb, var(--primary) 22%, var(--bg-card2))" : "var(--bg-input)",
                  border: `1px solid ${mode === m.id ? "color-mix(in srgb, var(--primary-light) 45%, transparent)" : "var(--border)"}`,
                }}
              >
                <input type="radio" name="analyse-mode" id={`analyse-mode-${m.id}`} checked={mode === m.id} onChange={() => setMode(m.id)} className="mt-1 accent-[#C49A28]" />
                <span>
                  <span className="block text-sm font-medium" style={{ color: "var(--text-main)" }}>{m.label}</span>
                  <span className="block text-xs" style={{ color: "var(--text-sub)" }}>{m.info}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {erreur && <p className="text-sm" style={{ color: "#fca5a5" }}>{erreur}</p>}

        <div className="flex gap-2">
          <button onClick={onFermer} className="hover-text-main flex-1 px-4 py-2.5 rounded-xl text-sm" style={{ border: "1px solid var(--border)", color: "var(--text-sub)" }}>
            Annuler
          </button>
          <button
            onClick={enregistrer}
            disabled={!valide || envoi}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white", boxShadow: "0 2px 12px var(--accent-glow)" }}
          >
            {envoi ? "…" : existant ? "Enregistrer" : "Créer et ouvrir la vidéo"}
          </button>
        </div>
      </div>
    </div>
  );
}
