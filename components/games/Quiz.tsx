"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { writeOrQueue } from "@/lib/offline";
import { getIdentity } from "@/lib/lancerFrancStats";

const QUESTIONS_PER_GAME = 10;
const SECONDS_PER_QUESTION = 20;
const BASE_POINTS = 100;
const BONUS_PER_SECOND = 5;
const accent = "#E8641C";

interface Question {
  id: string;
  question: string;
  answers: string[]; // déjà mélangées
  correct: number; // index dans `answers`
  categorie: string | null;
}

interface ScoreRow {
  prenom: string;
  score: number;
  bonnes: number;
  total: number;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const questionsQuery = () =>
  supabase
    .from("quiz_questions")
    .select("id, question, reponses, bonne, categorie")
    .eq("actif", true);

/** Met les questions en cache à l'ouverture de l'app : le quiz marche ensuite hors ligne (avion…). */
export async function prefetchQuizOffline() {
  await Promise.all([questionsQuery(), loadLeaderboard()]);
}

async function loadQuestions(): Promise<Question[] | null> {
  const { data, error } = await questionsQuery();
  if (error || !data) return null;
  const picked = shuffle(data as { id: string; question: string; reponses: string[]; bonne: number; categorie: string | null }[]).slice(0, QUESTIONS_PER_GAME);
  return picked.map((q) => {
    const order = shuffle(q.reponses.map((_, i) => i));
    return {
      id: q.id,
      question: q.question,
      answers: order.map((i) => q.reponses[i]),
      correct: order.indexOf(q.bonne),
      categorie: q.categorie,
    };
  });
}

async function loadLeaderboard(): Promise<ScoreRow[]> {
  const { data } = await supabase
    .from("quiz_scores")
    .select("prenom, score, bonnes, total")
    .order("score", { ascending: false })
    .limit(50);
  const best = new Map<string, ScoreRow>();
  for (const r of (data ?? []) as ScoreRow[]) {
    const key = r.prenom.toLowerCase();
    if (!best.has(key)) best.set(key, r);
  }
  return Array.from(best.values()).slice(0, 5);
}

type Phase = "loading" | "intro" | "playing" | "done";

export default function Quiz({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [available, setAvailable] = useState(true);
  const [board, setBoard] = useState<ScoreRow[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null); // -1 = temps écoulé
  const [timeLeft, setTimeLeft] = useState(SECONDS_PER_QUESTION);
  const [score, setScore] = useState(0);
  const [good, setGood] = useState(0);
  const scoreRef = useRef(0);
  const goodRef = useRef(0);
  const timeRef = useRef(SECONDS_PER_QUESTION);

  const refresh = useCallback(async () => {
    setPhase("loading");
    const [qs, lb] = await Promise.all([loadQuestions(), loadLeaderboard()]);
    setBoard(lb);
    setAvailable(!!qs && qs.length > 0);
    setQuestions(qs ?? []);
    setPhase("intro");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const start = () => {
    scoreRef.current = 0;
    goodRef.current = 0;
    setScore(0);
    setGood(0);
    setIndex(0);
    setPicked(null);
    timeRef.current = SECONDS_PER_QUESTION;
    setTimeLeft(SECONDS_PER_QUESTION);
    setPhase("playing");
  };

  const answer = useCallback(
    (choice: number) => {
      if (picked !== null) return;
      setPicked(choice);
      const q = questions[index];
      if (q && choice === q.correct) {
        goodRef.current += 1;
        scoreRef.current += BASE_POINTS + Math.ceil(timeRef.current) * BONUS_PER_SECOND;
        setGood(goodRef.current);
        setScore(scoreRef.current);
      }
    },
    [picked, questions, index],
  );

  // Chrono de la question en cours
  useEffect(() => {
    if (phase !== "playing" || picked !== null) return;
    const id = window.setInterval(() => {
      timeRef.current = Math.max(0, timeRef.current - 0.25);
      setTimeLeft(timeRef.current);
      if (timeRef.current <= 0) {
        window.clearInterval(id);
        setPicked(-1);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [phase, picked, index]);

  const next = useCallback(async () => {
    if (index + 1 < questions.length) {
      setIndex(index + 1);
      setPicked(null);
      timeRef.current = SECONDS_PER_QUESTION;
      setTimeLeft(SECONDS_PER_QUESTION);
      return;
    }
    setPhase("done");
    const who = getIdentity();
    // Sans réseau, le score est gardé et envoyé plus tard
    await writeOrQueue("quiz_scores", "insert", {
      payload: {
        user_id: who.id,
        prenom: who.label,
        score: scoreRef.current,
        bonnes: goodRef.current,
        total: questions.length,
      },
    });
    setBoard(await loadLeaderboard());
  }, [index, questions.length]);

  const card = { background: "var(--bg-card)", border: "1px solid var(--border-card)" } as const;
  const q = questions[index];

  return (
    <div className="space-y-4">
      <button onClick={onExit} className="text-sm" style={{ color: "var(--text-muted)" }}>
        ← Retour aux jeux
      </button>

      {phase === "loading" && (
        <p className="text-sm text-center py-10" style={{ color: "var(--text-muted)" }}>Chargement du quiz…</p>
      )}

      {(phase === "intro" || phase === "done") && (
        <div className="space-y-4">
          <div className="rounded-2xl p-5 text-center space-y-2" style={card}>
            <div className="text-4xl">❓</div>
            {phase === "done" ? (
              <>
                <h2 className="font-display text-2xl" style={{ color: "var(--text-main)" }}>
                  {good} / {questions.length}
                </h2>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>{score} points</p>
              </>
            ) : (
              <>
                <h2 className="font-display text-2xl" style={{ color: "var(--text-main)" }}>QUIZ</h2>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {QUESTIONS_PER_GAME} questions, {SECONDS_PER_QUESTION} s pour répondre. Plus tu réponds vite, plus tu marques.
                </p>
              </>
            )}
            {available ? (
              <button
                onClick={phase === "done" ? () => void refresh() : start}
                className="mt-2 w-full rounded-xl py-3 text-sm font-semibold text-white"
                style={{ background: accent }}
              >
                {phase === "done" ? "Rejouer" : "Jouer"}
              </button>
            ) : (
              <p className="text-sm pt-2" style={{ color: "var(--text-muted)" }}>
                Aucune question pour le moment. Le staff doit en ajouter.
              </p>
            )}
          </div>

          {board.length > 0 && (
            <div className="rounded-2xl p-4 space-y-2" style={card}>
              <p className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Meilleurs scores</p>
              {board.map((r, i) => (
                <div key={r.prenom} className="flex items-center justify-between text-sm">
                  <span style={{ color: "var(--text-main)" }}>{i + 1}. {r.prenom}</span>
                  <span style={{ color: "var(--text-muted)" }}>{r.score} pts · {r.bonnes}/{r.total}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {phase === "playing" && q && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
            <span>Question {index + 1} / {questions.length}</span>
            <span>{score} pts</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
            <div
              className="h-full transition-all"
              style={{ width: `${(timeLeft / SECONDS_PER_QUESTION) * 100}%`, background: timeLeft < 6 ? "#f87171" : accent }}
            />
          </div>
          <div className="rounded-2xl p-5" style={card}>
            {q.categorie && (
              <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--text-sub)" }}>{q.categorie}</p>
            )}
            <p className="text-base font-medium" style={{ color: "var(--text-main)" }}>{q.question}</p>
          </div>
          <div className="space-y-2">
            {q.answers.map((a, i) => {
              const revealed = picked !== null;
              const isRight = i === q.correct;
              let bg = "var(--bg-card)";
              let border = "var(--border-card)";
              if (revealed && isRight) { bg = "rgba(74,222,128,0.15)"; border = "#4ade80"; }
              else if (revealed && picked === i) { bg = "rgba(248,113,113,0.15)"; border = "#f87171"; }
              return (
                <button
                  key={i}
                  onClick={() => answer(i)}
                  disabled={revealed}
                  className="w-full text-left rounded-xl px-4 py-3 text-sm transition-all active:scale-[0.99]"
                  style={{ background: bg, border: `1px solid ${border}`, color: "var(--text-main)" }}
                >
                  {a}
                </button>
              );
            })}
          </div>
          {picked !== null && (
            <div className="space-y-2">
              {picked === -1 && (
                <p className="text-center text-sm" style={{ color: "#f87171" }}>Temps écoulé !</p>
              )}
              <button
                onClick={() => void next()}
                className="w-full rounded-xl py-3 text-sm font-semibold text-white"
                style={{ background: accent }}
              >
                {index + 1 < questions.length ? "Question suivante" : "Voir mon score"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
