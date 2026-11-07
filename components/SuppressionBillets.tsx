"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { todayISO } from "@/lib/dates";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Trajet {
  id: string;
  billet_id: number;
  gare_depart: string;
  gare_arrivee: string;
  date_depart: string;   // "YYYY-MM-DD"
  heure_depart: string;  // "HH:MM:SS"
  heure_arrivee: string; // "HH:MM:SS"
  type_train: string | null;
  numero_train: string | null;
}

interface Billet {
  id: number;
  nom_fichier: string;
  url_stockage: string;
  joueuse_id: string;
  personne_type: string | null;
  trajets: Trajet[];
}

interface Personne {
  id: string;
  prenom: string;
  nom: string;
  type: "joueuse" | "staff" | "inconnu";
  billets: Billet[];
}

type Pole = "masculin" | "feminin" | "both";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

function fmtHeure(t: string) {
  return (t ?? "").slice(0, 5).replace(":", "h");
}

function trainLabel(t: Trajet) {
  return [t.type_train, t.numero_train].filter(Boolean).join(" ");
}

function pnr(b: Billet) {
  const m = b.nom_fichier.match(/^([A-Z0-9]{6})_/);
  return m ? m[1] : null;
}

function trierTrajets(trajets: Trajet[]) {
  return [...trajets].sort((a, b) =>
    a.date_depart.localeCompare(b.date_depart) || a.heure_depart.localeCompare(b.heure_depart)
  );
}

function trajetTexte(t: Trajet) {
  return `${fmtDate(t.date_depart)} · ${t.gare_depart} ${fmtHeure(t.heure_depart)} → ${t.gare_arrivee} ${fmtHeure(t.heure_arrivee)}`;
}

// ─── Bloc « Suppression de billet » ─────────────────────────────────────────────

export default function SuppressionBillets({ pole }: { pole: Pole }) {
  const [personnes, setPersonnes] = useState<Personne[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [ouverte,   setOuverte]   = useState<Personne | null>(null);
  const [feedback,  setFeedback]  = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const charger = useCallback(async () => {
    setLoading(true);
    const [billetsRes, joueusesRes, staffRes] = await Promise.all([
      supabase.from("billets").select("id, nom_fichier, url_stockage, joueuse_id, personne_type, trajets(*)"),
      supabase.from("joueuses").select("id, prenom, nom, categorie"),
      supabase.from("staff").select("id, prenom, nom, masculin, feminin"),
    ]);

    const billets  = (billetsRes.data ?? []) as Billet[];
    const joueuses = joueusesRes.data ?? [];
    const staff    = staffRes.data ?? [];

    const parId = new Map<string, Personne>();
    for (const b of billets) {
      const id = b.joueuse_id;
      if (!parId.has(id)) {
        const j = joueuses.find((x) => x.id === id);
        const s = staff.find((x) => x.id === id);

        // Restreindre au périmètre du staff connecté (comme l'onglet Joueurs)
        if (pole !== "both") {
          if (j && j.categorie !== (pole === "masculin" ? "Masculin" : "Féminin")) continue;
          if (!j && s && !s[pole]) continue;
        }

        parId.set(id, j
          ? { id, prenom: j.prenom, nom: j.nom, type: "joueuse", billets: [] }
          : s
            ? { id, prenom: s.prenom, nom: s.nom, type: "staff", billets: [] }
            : { id, prenom: "Personne", nom: "inconnue", type: "inconnu", billets: [] });
      }
      parId.get(id)!.billets.push({ ...b, trajets: trierTrajets(b.trajets ?? []) });
    }

    const liste = [...parId.values()].sort((a, b) =>
      `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, "fr")
    );
    setPersonnes(liste);
    setLoading(false);
    return liste;
  }, [pole]);

  useEffect(() => { charger(); }, [charger]);

  const showFeedback = (type: "success" | "error", msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  };

  const apresSuppression = async (personneId: string, nbBillets: number, erreur?: string) => {
    const liste = await charger();
    if (erreur) {
      showFeedback("error", erreur);
    } else {
      showFeedback("success", `${nbBillets} billet${nbBillets > 1 ? "s" : ""} supprimé${nbBillets > 1 ? "s" : ""}.`);
    }
    // Garder la modale ouverte s'il reste des billets à cette personne
    setOuverte(liste.find((p) => p.id === personneId) ?? null);
  };

  return (
    <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
      <p className="text-xs uppercase tracking-widest font-medium mb-1" style={{ color: "var(--text-sub)" }}>
        Suppression de billet
      </p>
      <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
        Choisis une personne pour voir ses trajets et supprimer les billets correspondants (PDF compris).
      </p>

      {feedback && (
        <div className="rounded-xl px-4 py-3 text-sm font-medium mb-3"
          style={{
            background: feedback.type === "success" ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
            border: `1px solid ${feedback.type === "success" ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)"}`,
            color: feedback.type === "success" ? "#4ade80" : "#f87171",
          }}>
          {feedback.msg}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-6">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
        </div>
      ) : personnes.length === 0 ? (
        <p className="text-sm text-center py-6" style={{ color: "var(--text-muted)" }}>
          Aucun billet dans l&apos;app pour le moment
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {personnes.map((p) => {
            const nbTrajets = p.billets.reduce((n, b) => n + b.trajets.length, 0);
            return (
              <button key={p.id} onClick={() => setOuverte(p)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all active:scale-95 hover:opacity-80"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)" }}>
                <span>{p.prenom} {p.nom}</span>
                {p.type === "staff" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                    style={{ background: "rgba(196,154,40,0.15)", color: "#C49A28" }}>
                    Staff
                  </span>
                )}
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {nbTrajets} trajet{nbTrajets > 1 ? "s" : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {ouverte && (
        <ModaleTrajets
          personne={ouverte}
          onClose={() => setOuverte(null)}
          onDeleted={apresSuppression}
        />
      )}
    </div>
  );
}

// ─── Modale : trajets d'une personne ──────────────────────────────────────────

function ModaleTrajets({ personne, onClose, onDeleted }: {
  personne: Personne;
  onClose: () => void;
  onDeleted: (personneId: string, nbBillets: number, erreur?: string) => void;
}) {
  const [selection,    setSelection]    = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState(false);
  const [suppression,  setSuppression]  = useState(false);

  // Repartir de zéro quand la liste change (après une suppression)
  useEffect(() => { setSelection(new Set()); setConfirmation(false); }, [personne]);

  const today = todayISO();
  const trajets = useMemo(
    () => trierTrajets(personne.billets.flatMap((b) => b.trajets)),
    [personne]
  );
  const billetDe = useMemo(() => {
    const m = new Map<number, Billet>();
    personne.billets.forEach((b) => m.set(b.id, b));
    return m;
  }, [personne]);
  const billetsSansTrajet = useMemo(
    () => personne.billets.filter((b) => b.trajets.length === 0),
    [personne]
  );

  // Billets touchés par la sélection + trajets supprimés « par ricochet »
  const billetsTouches = useMemo(() => {
    const ids = new Set<number>();
    trajets.forEach((t) => { if (selection.has(t.id)) ids.add(t.billet_id); });
    billetsSansTrajet.forEach((b) => { if (selection.has(`billet-${b.id}`)) ids.add(b.id); });
    return [...ids].map((id) => billetDe.get(id)!).filter(Boolean);
  }, [selection, trajets, billetsSansTrajet, billetDe]);

  const trajetsEntraines = useMemo(
    () => billetsTouches.flatMap((b) => b.trajets).filter((t) => !selection.has(t.id)),
    [billetsTouches, selection]
  );

  const toggle = (key: string) => {
    setConfirmation(false);
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toutesCles = [...trajets.map((t) => t.id), ...billetsSansTrajet.map((b) => `billet-${b.id}`)];
  const toutSelectionne = toutesCles.length > 0 && toutesCles.every((k) => selection.has(k));
  const toggleTout = () => {
    setConfirmation(false);
    setSelection(toutSelectionne ? new Set() : new Set(toutesCles));
  };

  const supprimer = async () => {
    setSuppression(true);
    const ids = billetsTouches.map((b) => b.id);

    // Les trajets partent avec le billet (clé étrangère ON DELETE CASCADE)
    const { data, error } = await supabase.from("billets").delete().in("id", ids).select("id");
    if (error || !data || data.length === 0) {
      setSuppression(false);
      onDeleted(personne.id, 0,
        "La suppression a échoué (droits insuffisants sur la table billets ?).");
      return;
    }

    // PDF dans le storage — uniquement ceux des billets réellement supprimés
    const supprimes = new Set(data.map((d) => d.id as number));
    const fichiers = billetsTouches.filter((b) => supprimes.has(b.id)).map((b) => b.url_stockage);
    let erreur: string | undefined;
    if (fichiers.length) {
      const { error: errStorage } = await supabase.storage.from("Billets").remove(fichiers);
      if (errStorage) erreur = `Billets supprimés, mais erreur sur les PDF : ${errStorage.message}`;
    }
    if (!erreur && supprimes.size < ids.length) {
      erreur = `${supprimes.size} billet(s) supprimé(s) sur ${ids.length}.`;
    }

    setSuppression(false);
    onDeleted(personne.id, supprimes.size, erreur);
  };

  const nbSel = selection.size;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[300]" onClick={onClose}
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }} />
      <div className="fixed inset-0 z-[301] flex items-end sm:items-center justify-center sm:px-4 pointer-events-none">
        <div className="w-full sm:max-w-lg max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl overflow-hidden pointer-events-auto"
          style={{
            background: "linear-gradient(145deg,#0B1120,#0E1E38)",
            border: "1px solid rgba(43,80,160,0.35)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          }}>
          <div className="h-1 shrink-0" style={{ background: "linear-gradient(90deg,transparent,#1B3A8C,#C49A28,transparent)" }} />

          {/* En-tête */}
          <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3 shrink-0"
            style={{ borderBottom: "1px solid var(--border)" }}>
            <div>
              <p className="font-display text-base tracking-wider" style={{ color: "var(--text-main)" }}>
                {`${personne.prenom} ${personne.nom}`.toUpperCase()}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                {personne.billets.length} billet{personne.billets.length > 1 ? "s" : ""} · {trajets.length} trajet{trajets.length > 1 ? "s" : ""}
              </p>
            </div>
            <button onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
              ✕
            </button>
          </div>

          {/* Liste des trajets */}
          <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
            {toutesCles.length > 1 && (
              <button onClick={toggleTout} className="text-xs mb-1" style={{ color: "var(--accent)" }}>
                {toutSelectionne ? "Tout désélectionner" : "Tout sélectionner"}
              </button>
            )}

            {trajets.map((t) => {
              const sel = selection.has(t.id);
              const entraine = !sel && trajetsEntraines.some((x) => x.id === t.id);
              const b = billetDe.get(t.billet_id);
              const passe = t.date_depart < today;
              return (
                <label key={t.id}
                  className="flex items-start gap-3 rounded-xl px-3 py-3 cursor-pointer transition-all"
                  style={{
                    background: sel
                      ? "rgba(248,113,113,0.10)"
                      : entraine ? "rgba(251,191,36,0.08)" : "var(--bg-input)",
                    border: `1px solid ${sel
                      ? "rgba(248,113,113,0.35)"
                      : entraine ? "rgba(251,191,36,0.35)" : "var(--border)"}`,
                    opacity: passe && !sel && !entraine ? 0.7 : 1,
                  }}>
                  <input type="checkbox" checked={sel} onChange={() => toggle(t.id)}
                    className="mt-1 w-4 h-4 shrink-0 accent-red-400" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                        {fmtDate(t.date_depart)}{passe ? " · passé" : ""}
                      </p>
                      {trainLabel(t) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                          style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-sub)" }}>
                          {trainLabel(t)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm mt-0.5" style={{ color: "var(--text-main)" }}>
                      {t.gare_depart} <span style={{ color: "var(--text-muted)" }}>{fmtHeure(t.heure_depart)}</span>
                      {" → "}
                      {t.gare_arrivee} <span style={{ color: "var(--text-muted)" }}>{fmtHeure(t.heure_arrivee)}</span>
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                      Billet {b && pnr(b) ? pnr(b) : `#${t.billet_id}`}
                      {b && b.trajets.length > 1 ? ` · ${b.trajets.length} trajets sur ce billet` : ""}
                      {entraine ? " · sera aussi supprimé" : ""}
                    </p>
                  </div>
                </label>
              );
            })}

            {billetsSansTrajet.map((b) => {
              const key = `billet-${b.id}`;
              const sel = selection.has(key);
              return (
                <label key={key}
                  className="flex items-start gap-3 rounded-xl px-3 py-3 cursor-pointer"
                  style={{
                    background: sel ? "rgba(248,113,113,0.10)" : "var(--bg-input)",
                    border: `1px solid ${sel ? "rgba(248,113,113,0.35)" : "var(--border)"}`,
                  }}>
                  <input type="checkbox" checked={sel} onChange={() => toggle(key)}
                    className="mt-1 w-4 h-4 shrink-0 accent-red-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm" style={{ color: "var(--text-main)" }}>Billet sans trajet détecté</p>
                    <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>{b.nom_fichier}</p>
                  </div>
                </label>
              );
            })}
          </div>

          {/* Pied : confirmation ou bouton */}
          <div className="px-5 py-4 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
            {confirmation ? (
              <div className="space-y-3">
                {trajetsEntraines.length > 0 ? (
                  <div className="rounded-xl px-3 py-3"
                    style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.35)" }}>
                    <p className="text-sm font-medium" style={{ color: "#fbbf24" }}>
                      Attention : {trajetsEntraines.length > 1 ? "d'autres trajets sont" : "un autre trajet est"} sur le même billet
                    </p>
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      Supprimer le billet supprimera aussi :
                    </p>
                    <ul className="text-xs mt-1 space-y-0.5" style={{ color: "var(--text-main)" }}>
                      {trajetsEntraines.map((t) => <li key={t.id}>• {trajetTexte(t)}</li>)}
                    </ul>
                  </div>
                ) : null}
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Supprimer définitivement {billetsTouches.length} billet{billetsTouches.length > 1 ? "s" : ""}
                  {" "}({billetsTouches.reduce((n, b) => n + b.trajets.length, 0)} trajet
                  {billetsTouches.reduce((n, b) => n + b.trajets.length, 0) > 1 ? "s" : ""}, PDF compris) ?
                  Cette action est irréversible.
                </p>
                <div className="flex gap-2">
                  <button onClick={supprimer} disabled={suppression}
                    className="flex-1 py-3 rounded-xl text-sm font-display tracking-widest transition-all active:scale-95 disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg,#ef4444,#b91c1c)", color: "white" }}>
                    {suppression ? "SUPPRESSION…" : "CONFIRMER"}
                  </button>
                  <button onClick={() => setConfirmation(false)} disabled={suppression}
                    className="px-4 py-3 rounded-xl text-sm font-medium"
                    style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmation(true)} disabled={nbSel === 0}
                className="w-full py-3 rounded-xl text-sm font-display tracking-widest transition-all active:scale-95 disabled:opacity-40"
                style={{ background: "linear-gradient(135deg,#ef4444,#b91c1c)", color: "white" }}>
                {nbSel === 0
                  ? "SÉLECTIONNE DES TRAJETS"
                  : `SUPPRIMER ${billetsTouches.length} BILLET${billetsTouches.length > 1 ? "S" : ""}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
