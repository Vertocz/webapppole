"use client";

/**
 * QuestionnaireTab.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Onglet joueuse : répond au questionnaire en attente (s'il y en a un) et
 * consulte l'historique de ses réponses précédentes.
 *
 * À monter uniquement si la joueuse est destinataire d'au moins un
 * questionnaire (voir app/player/page.tsx pour la détection + l'ajout
 * conditionnel de l'onglet en fin de liste).
 */

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import Card from "./Card";

interface QuestionnaireRow {
  id: string;
  titre: string;
  questions: string[];
  created_at: string;
}

interface ReponseRow {
  questionnaire_id: string;
  reponses: string[];
  submitted_at: string;
}

export default function QuestionnaireTab({ userId }: { userId: string }) {
  const [assigned, setAssigned] = useState<QuestionnaireRow[]>([]);
  const [reponses, setReponses] = useState<ReponseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [expandedHistorique, setExpandedHistorique] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: dest } = await supabase
      .from("questionnaire_destinataires")
      .select("questionnaire_id")
      .eq("joueuse_id", userId);
    const ids = (dest ?? []).map((d) => d.questionnaire_id);

    if (ids.length === 0) {
      setAssigned([]);
      setReponses([]);
      setLoading(false);
      return;
    }

    const [{ data: qData }, { data: repData }] = await Promise.all([
      supabase.from("questionnaires").select("id, titre, questions, created_at").in("id", ids).order("created_at", { ascending: false }),
      supabase.from("questionnaire_reponses").select("questionnaire_id, reponses, submitted_at").eq("joueuse_id", userId),
    ]);

    setAssigned((qData ?? []) as QuestionnaireRow[]);
    setReponses((repData ?? []) as ReponseRow[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const reponduIds = new Set(reponses.map((r) => r.questionnaire_id));
  const enAttente = assigned.filter((q) => !reponduIds.has(q.id));
  const repondus = assigned.filter((q) => reponduIds.has(q.id));
  const courant = enAttente[0] ?? null;

  // Initialise le formulaire quand un nouveau questionnaire en attente apparaît
  useEffect(() => {
    if (courant) setAnswers(new Array(courant.questions.length).fill(""));
  }, [courant?.id]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  const handleChange = (i: number, val: string) => {
    setAnswers((prev) => prev.map((a, idx) => (idx === i ? val : a)));
  };

  const handleSubmit = async () => {
    if (!courant) return;
    if (answers.some((a) => !a.trim())) { setError("Merci de répondre à toutes les questions."); return; }
    setSaving(true);
    setError("");
    const { error: err } = await supabase.from("questionnaire_reponses").insert({
      questionnaire_id: courant.id,
      joueuse_id: userId,
      reponses: answers,
    });
    setSaving(false);
    if (err) { setError("Erreur lors de l'envoi : " + err.message); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    await load();
  };

  return (
    <div className="space-y-6">
      {courant ? (
        <Card>
          <h2 className="font-display text-2xl mb-1" style={{ color: "var(--text-main)" }}>{courant.titre}</h2>
          <p className="text-xs mb-5" style={{ color: "var(--text-muted)" }}>
            Réponds à ces questions et envoie — le staff pourra consulter tes réponses.
          </p>

          <div className="space-y-4">
            {courant.questions.map((q, i) => (
              <div key={i}>
                <label
                  style={{
                    display: "block", fontSize: "0.7rem", fontWeight: 500,
                    letterSpacing: "0.1em", textTransform: "uppercase",
                    color: "var(--text-sub)", marginBottom: "0.5rem",
                  }}
                >
                  {i + 1}. {q}
                </label>
                <textarea
                  value={answers[i] ?? ""}
                  onChange={(e) => handleChange(i, e.target.value)}
                  rows={3}
                  placeholder="Ta réponse..."
                  className="w-full px-4 py-3 rounded-xl outline-none resize-none"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)" }}
                />
              </div>
            ))}
          </div>

          {error && (
            <div className="rounded-lg px-4 py-3 text-sm mt-4" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}>
              {error}
            </div>
          )}
          {saved && (
            <div className="rounded-lg px-4 py-3 text-sm mt-4 animate-slide-in" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", color: "#86efac" }}>
              ✅ Réponses envoyées !
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={saving}
            className="w-full py-3.5 rounded-xl font-display text-lg tracking-widest transition-all disabled:opacity-40 mt-5"
            style={{ background: "linear-gradient(135deg, var(--accent), var(--accent2))", color: "white", boxShadow: "0 4px 20px var(--accent-glow)" }}
          >
            {saving ? "Envoi..." : "ENVOYER"}
          </button>
        </Card>
      ) : assigned.length === 0 ? (
        <Card>
          <p className="text-center py-6" style={{ color: "var(--text-muted)" }}>
            Aucun questionnaire pour le moment.
          </p>
        </Card>
      ) : null}

      {repondus.length > 0 && (
        <div>
          <h3 className="font-display text-xl mb-3" style={{ color: "var(--text-main)" }}>MES RÉPONSES PRÉCÉDENTES</h3>
          <div className="space-y-3">
            {repondus.map((q) => {
              const rep = reponses.find((r) => r.questionnaire_id === q.id)!;
              const isOpen = expandedHistorique === q.id;
              return (
                <Card key={q.id}>
                  <button onClick={() => setExpandedHistorique(isOpen ? null : q.id)} className="w-full text-left">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium" style={{ color: "var(--text-main)" }}>{q.titre}</p>
                        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                          Envoyé le {new Date(rep.submitted_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                        </p>
                      </div>
                      <span style={{ color: "var(--text-muted)" }}>{isOpen ? "▲" : "▼"}</span>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="mt-4 space-y-3" style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
                      {q.questions.map((question, i) => (
                        <div key={i}>
                          <p className="text-xs font-medium mb-1" style={{ color: "var(--text-sub)" }}>{question}</p>
                          <p className="text-sm" style={{ color: "var(--text-main)" }}>{rep.reponses[i] || "—"}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
