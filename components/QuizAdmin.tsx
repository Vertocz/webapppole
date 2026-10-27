"use client";

/**
 * QuizAdmin.tsx — saisie des questions du quiz par le staff masculin.
 * Tables Supabase : voir supabase/quiz.sql
 *   {user.masculin && <QuizAdmin staffId={user.id} />}
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const accent = "#E8641C";

export interface QuizQuestionRow {
  id: string;
  question: string;
  reponses: string[];
  bonne: number;
  categorie: string | null;
  actif: boolean;
  created_at: string;
}

export default function QuizAdmin({ staffId }: { staffId: string }) {
  const [rows, setRows] = useState<QuizQuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [reponses, setReponses] = useState<string[]>(["", "", "", ""]);
  const [bonne, setBonne] = useState(0);
  const [categorie, setCategorie] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("quiz_questions")
      .select("id, question, reponses, bonne, categorie, actif, created_at")
      .order("created_at", { ascending: false });
    if (err) setError("Impossible de charger les questions : " + err.message);
    else {
      setError("");
      setRows((data ?? []) as QuizQuestionRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filled = reponses.map((r) => r.trim());
  const nonEmpty = filled.filter(Boolean);
  const valid = question.trim().length > 3 && nonEmpty.length >= 2 && filled[bonne] !== "";

  const add = async () => {
    if (!valid || saving) return;
    setSaving(true);
    // On retire les cases vides en recalculant l'index de la bonne réponse.
    const kept = filled.map((r, i) => ({ r, i })).filter((x) => x.r);
    const newBonne = kept.findIndex((x) => x.i === bonne);
    const { error: err } = await supabase.from("quiz_questions").insert({
      question: question.trim(),
      reponses: kept.map((x) => x.r),
      bonne: newBonne,
      categorie: categorie.trim() || null,
      auteur_id: String(staffId),
    });
    setSaving(false);
    if (err) {
      setError("Enregistrement impossible : " + err.message);
      return;
    }
    setQuestion("");
    setReponses(["", "", "", ""]);
    setBonne(0);
    await load();
  };

  const toggle = async (row: QuizQuestionRow) => {
    await supabase.from("quiz_questions").update({ actif: !row.actif }).eq("id", row.id);
    await load();
  };

  const remove = async (row: QuizQuestionRow) => {
    if (!window.confirm("Supprimer cette question ?")) return;
    await supabase.from("quiz_questions").delete().eq("id", row.id);
    await load();
  };

  const inputStyle = {
    background: "var(--bg-input)",
    border: "1px solid var(--border)",
    color: "var(--text-main)",
  } as const;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-4 space-y-3" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
        <p className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>Nouvelle question</p>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          placeholder="Ta question…"
          className="w-full rounded-xl px-3 py-2 text-sm outline-none"
          style={inputStyle}
        />
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          2 à 4 réponses. Coche la bonne.
        </p>
        {reponses.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="radio"
              name="bonne"
              checked={bonne === i}
              onChange={() => setBonne(i)}
              aria-label={`Réponse ${i + 1} correcte`}
              style={{ accentColor: accent }}
            />
            <input
              value={r}
              onChange={(e) => setReponses((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={`Réponse ${i + 1}${i < 2 ? "" : " (facultatif)"}`}
              className="flex-1 rounded-xl px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
          </div>
        ))}
        <input
          value={categorie}
          onChange={(e) => setCategorie(e.target.value)}
          placeholder="Catégorie (facultatif) : basket, équipe, culture…"
          className="w-full rounded-xl px-3 py-2 text-sm outline-none"
          style={inputStyle}
        />
        <button
          type="button"
          onClick={add}
          disabled={!valid || saving}
          className="w-full rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: accent }}
        >
          {saving ? "Enregistrement…" : "Ajouter la question"}
        </button>
        {error && <p className="text-xs" style={{ color: "#f87171" }}>{error}</p>}
      </div>

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          {rows.length} question{rows.length > 1 ? "s" : ""}
        </p>
        {loading && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement…</p>}
        {rows.map((q) => (
          <div
            key={q.id}
            className="rounded-xl p-3 space-y-1.5"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", opacity: q.actif ? 1 : 0.5 }}
          >
            <p className="text-sm font-medium" style={{ color: "var(--text-main)" }}>{q.question}</p>
            <ul className="text-xs space-y-0.5">
              {q.reponses.map((r, i) => (
                <li key={i} style={{ color: i === q.bonne ? "#4ade80" : "var(--text-muted)" }}>
                  {i === q.bonne ? "✓ " : "• "}
                  {r}
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-sub)" }}>
                {q.categorie ?? ""}
              </span>
              <div className="flex gap-3 text-xs">
                <button type="button" onClick={() => toggle(q)} style={{ color: "var(--text-muted)" }}>
                  {q.actif ? "Désactiver" : "Réactiver"}
                </button>
                <button type="button" onClick={() => remove(q)} style={{ color: "#f87171" }}>
                  Supprimer
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
