"use client";

/**
 * QuestionnaireAdmin.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Panneau admin pour créer des questionnaires ciblés (texte libre uniquement)
 * et consulter les réponses reçues, par joueuse ou par question.
 *
 * À monter dans l'onglet Admin, réservé aux staffs du pôle féminin :
 *   {user.feminin && <QuestionnaireAdmin staffId={user.id} />}
 *
 * Tables Supabase requises : voir questionnaires_schema.sql
 */

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const accent = "#E8641C";

interface Joueuse {
  id: string;
  prenom: string;
  nom: string;
  categorie?: string;
}

interface QuestionnaireRow {
  id: string;
  titre: string;
  questions: string[];
  created_at: string;
}

interface ReponseRow {
  joueuse_id: string;
  reponses: string[];
  submitted_at: string;
}

type View = "liste" | "creer" | "detail";

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(43,80,160,0.25)",
  color: "var(--text-main)",
  borderRadius: "0.625rem",
  padding: "0.6rem 0.85rem",
  fontSize: "0.875rem",
  outline: "none",
  width: "100%",
};

export default function QuestionnaireAdmin({ staffId }: { staffId: string }) {
  const [view, setView] = useState<View>("liste");
  const [questionnaires, setQuestionnaires] = useState<QuestionnaireRow[]>([]);
  const [destinatairesCount, setDestinatairesCount] = useState<Record<string, number>>({});
  const [reponsesCount, setReponsesCount] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<QuestionnaireRow | null>(null);

  // ── Formulaire création ──────────────────────────────────────────────────
  const [titre, setTitre] = useState("");
  const [questions, setQuestions] = useState<string[]>(["", "", "", "", ""]);
  const [joueuses, setJoueuses] = useState<Joueuse[]>([]);
  const [selectedJoueuses, setSelectedJoueuses] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadList = useCallback(async () => {
    setLoading(true);
    const { data: qs } = await supabase
      .from("questionnaires")
      .select("id, titre, questions, created_at")
      .order("created_at", { ascending: false });
    setQuestionnaires((qs ?? []) as QuestionnaireRow[]);

    if (qs && qs.length > 0) {
      const ids = qs.map((q) => q.id);
      const [{ data: dest }, { data: rep }] = await Promise.all([
        supabase.from("questionnaire_destinataires").select("questionnaire_id").in("questionnaire_id", ids),
        supabase.from("questionnaire_reponses").select("questionnaire_id").in("questionnaire_id", ids),
      ]);
      const dCounts: Record<string, number> = {};
      (dest ?? []).forEach((d) => { dCounts[d.questionnaire_id] = (dCounts[d.questionnaire_id] ?? 0) + 1; });
      const rCounts: Record<string, number> = {};
      (rep ?? []).forEach((r) => { rCounts[r.questionnaire_id] = (rCounts[r.questionnaire_id] ?? 0) + 1; });
      setDestinatairesCount(dCounts);
      setReponsesCount(rCounts);
    } else {
      setDestinatairesCount({});
      setReponsesCount({});
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const loadJoueuses = useCallback(async () => {
    const { data } = await supabase
      .from("joueuses")
      .select("id, prenom, nom, categorie")
      .eq("categorie", "Féminin")
      .order("prenom");
    setJoueuses(data ?? []);
  }, []);

  const startCreate = () => {
    setTitre("");
    setQuestions(["", "", "", "", ""]);
    setSelectedJoueuses(new Set());
    setError("");
    loadJoueuses();
    setView("creer");
  };

  const updateQuestion = (i: number, val: string) => {
    setQuestions((prev) => prev.map((q, idx) => (idx === i ? val : q)));
  };
  const addQuestion = () => setQuestions((prev) => [...prev, ""]);
  const removeQuestion = (i: number) => setQuestions((prev) => prev.filter((_, idx) => idx !== i));

  const toggleJoueuse = (id: string) => {
    setSelectedJoueuses((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedJoueuses(new Set(joueuses.map((j) => j.id)));
  const clearAll = () => setSelectedJoueuses(new Set());

  const handleCreate = async () => {
    const cleanQuestions = questions.map((q) => q.trim()).filter(Boolean);
    if (!titre.trim()) { setError("Le titre est obligatoire."); return; }
    if (cleanQuestions.length === 0) { setError("Ajoute au moins une question."); return; }
    if (selectedJoueuses.size === 0) { setError("Sélectionne au moins une joueuse."); return; }

    setSaving(true);
    setError("");

    const { data: qRow, error: qErr } = await supabase
      .from("questionnaires")
      .insert({ titre: titre.trim(), questions: cleanQuestions, created_by: staffId })
      .select("id")
      .single();

    if (qErr || !qRow) {
      setError("Erreur lors de la création : " + (qErr?.message ?? "inconnue"));
      setSaving(false);
      return;
    }

    const { error: dErr } = await supabase.from("questionnaire_destinataires").insert(
      [...selectedJoueuses].map((joueuse_id) => ({ questionnaire_id: qRow.id, joueuse_id }))
    );

    setSaving(false);

    if (dErr) {
      setError("Questionnaire créé mais erreur lors de l'envoi : " + dErr.message);
      return;
    }

    setView("liste");
    loadList();
  };

  const openDetail = (q: QuestionnaireRow) => { setSelected(q); setView("detail"); };

  return (
    <div className="space-y-4">
      {view === "liste" && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-widest font-medium" style={{ color: "var(--text-sub)" }}>
              {questionnaires.length} questionnaire{questionnaires.length > 1 ? "s" : ""}
            </p>
            <button
              onClick={startCreate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-95"
              style={{ background: `linear-gradient(135deg, ${accent}, #C0501A)`, color: "white", boxShadow: `0 2px 8px ${accent}44` }}
            >
              <span>+</span><span>Nouveau questionnaire</span>
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: accent, borderTopColor: "transparent" }} />
            </div>
          ) : questionnaires.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>
              Aucun questionnaire créé pour l&apos;instant.
            </p>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              {questionnaires.map((q, i) => {
                const total = destinatairesCount[q.id] ?? 0;
                const recus = reponsesCount[q.id] ?? 0;
                return (
                  <button
                    key={q.id}
                    onClick={() => openDetail(q)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
                    style={{ background: "var(--bg-card)", borderBottom: i < questionnaires.length - 1 ? "1px solid var(--border)" : "none" }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold" style={{ color: "var(--text-main)" }}>{q.titre}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                        {new Date(q.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                        {" · "}{q.questions.length} question{q.questions.length > 1 ? "s" : ""}
                      </p>
                    </div>
                    <span
                      className="text-xs font-bold px-2 py-1 rounded-full shrink-0"
                      style={{
                        background: total > 0 && recus === total ? "rgba(74,222,128,0.15)" : `${accent}18`,
                        color: total > 0 && recus === total ? "#4ade80" : accent,
                      }}
                    >
                      {recus}/{total}
                    </span>
                    <span style={{ color: "var(--text-muted)" }}>›</span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {view === "creer" && (
        <div className="space-y-4">
          <button
            onClick={() => setView("liste")}
            className="text-xs px-2 py-1 rounded-lg"
            style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}
          >
            ← Retour
          </button>

          <div className="rounded-2xl p-5 space-y-4" style={{ background: "var(--bg-card)", border: `1px solid ${accent}33` }}>
            <p className="text-xs uppercase tracking-widest font-bold" style={{ color: accent }}>
              Nouveau questionnaire
            </p>

            <div>
              <label className="text-[11px] uppercase tracking-widest mb-1.5 block" style={{ color: "var(--text-sub)" }}>
                Titre
              </label>
              <input value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="Ex : Bilan de mi-saison" style={inputStyle} />
            </div>

            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-widest block" style={{ color: "var(--text-sub)" }}>
                Questions
              </label>
              {questions.map((q, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs font-bold w-5 text-center shrink-0" style={{ color: "var(--text-muted)" }}>
                    {i + 1}
                  </span>
                  <input value={q} onChange={(e) => updateQuestion(i, e.target.value)} placeholder={`Question ${i + 1}`} style={inputStyle} />
                  {questions.length > 1 && (
                    <button
                      onClick={() => removeQuestion(i)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-xs shrink-0"
                      style={{ background: "rgba(248,113,113,0.1)", color: "#f87171" }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {questions.length < 10 && (
                <button onClick={addQuestion} className="text-xs px-2 py-1 rounded-lg" style={{ color: accent }}>
                  + Ajouter une question
                </button>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] uppercase tracking-widest block" style={{ color: "var(--text-sub)" }}>
                  Destinataires ({selectedJoueuses.size})
                </label>
                <div className="flex gap-2">
                  <button onClick={selectAll} className="text-xs" style={{ color: "var(--text-muted)" }}>Tout</button>
                  <span style={{ color: "var(--border)" }}>·</span>
                  <button onClick={clearAll} className="text-xs" style={{ color: "var(--text-muted)" }}>Aucune</button>
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                {joueuses.map((j) => {
                  const sel = selectedJoueuses.has(j.id);
                  return (
                    <button
                      key={j.id}
                      onClick={() => toggleJoueuse(j.id)}
                      className="w-full flex items-center gap-3 rounded-lg px-3 py-2 transition-all text-left"
                      style={{
                        background: sel ? `${accent}15` : "rgba(255,255,255,0.03)",
                        border: `1px solid ${sel ? accent + "55" : "rgba(43,80,160,0.15)"}`,
                      }}
                    >
                      <div
                        className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                        style={{ border: `1.5px solid ${sel ? accent : "var(--border)"}`, background: sel ? accent : "transparent" }}
                      >
                        {sel && <span style={{ color: "white", fontSize: 9 }}>✓</span>}
                      </div>
                      <span className="text-sm" style={{ color: "var(--text-main)" }}>{j.prenom} {j.nom}</span>
                    </button>
                  );
                })}
                {joueuses.length === 0 && (
                  <p className="text-xs text-center py-3" style={{ color: "var(--text-muted)" }}>
                    Aucune joueuse du pôle féminin trouvée.
                  </p>
                )}
              </div>
            </div>

            {error && (
              <p className="text-xs rounded-lg px-3 py-2" style={{ background: "rgba(248,113,113,0.1)", color: "#f87171", border: "1px solid rgba(248,113,113,0.2)" }}>
                {error}
              </p>
            )}

            <button
              onClick={handleCreate}
              disabled={saving}
              className="w-full py-3 rounded-xl font-display text-sm tracking-widest transition-all disabled:opacity-40"
              style={{ background: `linear-gradient(135deg, ${accent}, #C0501A)`, color: "white" }}
            >
              {saving ? "Envoi…" : "ENVOYER LE QUESTIONNAIRE"}
            </button>
          </div>
        </div>
      )}

      {view === "detail" && selected && (
        <QuestionnaireDetail questionnaire={selected} onBack={() => { setView("liste"); loadList(); }} />
      )}
    </div>
  );
}

// ─── Détail d'un questionnaire (résultats) ─────────────────────────────────────
function QuestionnaireDetail({ questionnaire, onBack }: { questionnaire: QuestionnaireRow; onBack: () => void }) {
  const [mode, setMode] = useState<"joueuse" | "question">("joueuse");
  const [loading, setLoading] = useState(true);
  const [destinataires, setDestinataires] = useState<Joueuse[]>([]);
  const [reponses, setReponses] = useState<ReponseRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: dest } = await supabase
        .from("questionnaire_destinataires")
        .select("joueuse_id")
        .eq("questionnaire_id", questionnaire.id);
      const ids = (dest ?? []).map((d) => d.joueuse_id);

      const [{ data: joueusesData }, { data: repData }] = await Promise.all([
        ids.length
          ? supabase.from("joueuses").select("id, prenom, nom").in("id", ids)
          : Promise.resolve({ data: [] as Joueuse[] }),
        supabase.from("questionnaire_reponses").select("joueuse_id, reponses, submitted_at").eq("questionnaire_id", questionnaire.id),
      ]);

      if (cancelled) return;
      setDestinataires((joueusesData ?? []) as Joueuse[]);
      setReponses((repData ?? []) as ReponseRow[]);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [questionnaire.id]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: accent, borderTopColor: "transparent" }} />
      </div>
    );
  }

  const reponseParJoueuse = new Map(reponses.map((r) => [r.joueuse_id, r]));

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-xs px-2 py-1 rounded-lg" style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}>
        ← Retour à la liste
      </button>

      <div className="rounded-2xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
        <p className="font-display text-lg" style={{ color: "var(--text-main)" }}>{questionnaire.titre}</p>
        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          {reponses.length}/{destinataires.length} réponse{destinataires.length > 1 ? "s" : ""} reçue{reponses.length > 1 ? "s" : ""}
        </p>
      </div>

      <div className="flex rounded-xl p-1 gap-1" style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
        {(["joueuse", "question"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
            style={mode === m
              ? { background: `linear-gradient(135deg, ${accent}, #C0501A)`, color: "white" }
              : { color: "var(--text-muted)" }}
          >
            {m === "joueuse" ? "Par joueuse" : "Par question"}
          </button>
        ))}
      </div>

      {mode === "joueuse" ? (
        <div className="space-y-2">
          {destinataires.map((j) => {
            const rep = reponseParJoueuse.get(j.id);
            const isOpen = expanded === j.id;
            return (
              <div key={j.id} className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--bg-card)" }}>
                <button
                  onClick={() => rep && setExpanded(isOpen ? null : j.id)}
                  disabled={!rep}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                >
                  <span className="text-sm font-medium flex-1" style={{ color: "var(--text-main)" }}>{j.prenom} {j.nom}</span>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: rep ? "rgba(74,222,128,0.15)" : "rgba(255,255,255,0.06)", color: rep ? "#4ade80" : "var(--text-muted)" }}
                  >
                    {rep ? "✓ Répondu" : "En attente"}
                  </span>
                  {rep && <span style={{ color: "var(--text-muted)" }}>{isOpen ? "▲" : "▼"}</span>}
                </button>
                {isOpen && rep && (
                  <div className="px-4 pb-4 space-y-3" style={{ borderTop: "1px solid var(--border)" }}>
                    {questionnaire.questions.map((q, i) => (
                      <div key={i} className="pt-3">
                        <p className="text-xs font-medium mb-1" style={{ color: "var(--text-sub)" }}>{q}</p>
                        <p className="text-sm" style={{ color: "var(--text-main)" }}>{rep.reponses[i] || "—"}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          {questionnaire.questions.map((q, i) => (
            <div key={i} className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
              <p className="text-sm font-bold mb-3" style={{ color: accent }}>{i + 1}. {q}</p>
              <div className="space-y-2">
                {destinataires.map((j) => {
                  const rep = reponseParJoueuse.get(j.id);
                  return (
                    <div key={j.id} className="text-sm pb-2" style={{ borderBottom: "1px solid var(--border)" }}>
                      <span className="font-medium" style={{ color: "var(--text-main)" }}>{j.prenom} {j.nom}</span>
                      <span style={{ color: "var(--text-muted)" }}> — </span>
                      <span style={{ color: rep ? "var(--text-sub)" : "var(--text-muted)" }}>
                        {rep ? (rep.reponses[i] || "—") : "En attente"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
