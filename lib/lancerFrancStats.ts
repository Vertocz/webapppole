import { supabase } from "./supabase";
import { getSessionUser } from "./session";

/**
 * Stats « de tout le temps » du lancer franc.
 *  - Toujours sauvegardées en local (le jeu marche hors ligne, en avion).
 *  - Synchronisées avec Supabase dès qu'il y a du réseau (table lancer_franc_stats).
 *  - Le recordman = meilleur pourcentage de réussite parmi ceux qui ont tiré
 *    au moins MIN_ATTEMPTS_RECORD fois (sinon 1/1 = 100 % battrait tout le monde).
 */

export const MIN_ATTEMPTS_RECORD = 20;

export interface LFStats {
  makes: number;
  attempts: number;
  best: number; // série max de tous les temps
}

export interface LFIdentity {
  id: string;
  label: string; // prénom seul : « Camille »
}

export interface Recordman {
  label: string;
  pct: number;
  best: number;
  attempts: number;
  mine: boolean;
}

const EMPTY: LFStats = { makes: 0, attempts: 0, best: 0 };
const TABLE = "lancer_franc_stats";

const statsKey = (id: string) => `lf-stats:${id}`;
const RECORD_KEY = "lf-recordman";

export function getIdentity(): LFIdentity {
  try {
    const u = getSessionUser<{ id?: string | number; prenom?: string; nom?: string }>();
    if (u) {
      if (u.id !== undefined && u.prenom) {
        return { id: String(u.id), label: u.prenom.trim() };
      }
    }
  } catch {
    /* ignoré */
  }
  return { id: "local", label: "Moi" };
}

export function loadLocalStats(id: string): LFStats {
  try {
    const raw = localStorage.getItem(statsKey(id));
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as LFStats) };
  } catch {
    /* ignoré */
  }
  return { ...EMPTY };
}

export function saveLocalStats(id: string, s: LFStats) {
  try {
    localStorage.setItem(statsKey(id), JSON.stringify(s));
  } catch {
    /* stockage plein ou bloqué : on continue sans */
  }
}

/** Fusionne local et serveur : on garde celui qui a le plus de tirs, et la meilleure série des deux. */
export function mergeStats(a: LFStats, b: LFStats): LFStats {
  const base = b.attempts > a.attempts ? b : a;
  return { makes: base.makes, attempts: base.attempts, best: Math.max(a.best, b.best) };
}

interface Row {
  joueuse_id: string;
  prenom: string;
  nom: string | null;
  makes: number;
  attempts: number;
  best_streak: number;
}

export async function pushStats(who: LFIdentity, s: LFStats): Promise<boolean> {
  if (who.id === "local") return false;
  try {
    const { error } = await supabase.from(TABLE).upsert(
      {
        joueuse_id: who.id,
        prenom: who.label,
        nom: null,
        makes: s.makes,
        attempts: s.attempts,
        best_streak: s.best,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "joueuse_id" }
    );
    return !error;
  } catch {
    return false;
  }
}

export async function pullMyStats(who: LFIdentity): Promise<LFStats | null> {
  if (who.id === "local") return null;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("makes,attempts,best_streak")
      .eq("joueuse_id", who.id)
      .maybeSingle();
    if (error || !data) return null;
    return { makes: data.makes, attempts: data.attempts, best: data.best_streak };
  } catch {
    return null;
  }
}

/** Recordman global. `mine` sert à y glisser mes stats locales, plus fraîches que celles du serveur. */
export async function fetchRecordman(who: LFIdentity, mine: LFStats): Promise<Recordman | null> {
  let rows: Row[] = [];
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("joueuse_id,prenom,nom,makes,attempts,best_streak")
      .gte("attempts", MIN_ATTEMPTS_RECORD);
    if (!error && data) rows = data as Row[];
    else throw new Error("offline");
  } catch {
    const cached = loadCachedRecordman();
    return pickWithMine(cached ? [cached] : [], who, mine);
  }
  const list: Recordman[] = rows.map((r) => ({
    label: `${r.prenom}${r.nom ? ` ${r.nom}` : ""}`,
    pct: r.attempts > 0 ? r.makes / r.attempts : 0,
    best: r.best_streak,
    attempts: r.attempts,
    mine: r.joueuse_id === who.id,
  }));
  const best = pickWithMine(list, who, mine, true);
  if (best) {
    try {
      localStorage.setItem(RECORD_KEY, JSON.stringify({ ...best, mine: false }));
    } catch {
      /* ignoré */
    }
  }
  return best;
}

function loadCachedRecordman(): Recordman | null {
  try {
    const raw = localStorage.getItem(RECORD_KEY);
    return raw ? (JSON.parse(raw) as Recordman) : null;
  } catch {
    return null;
  }
}

/** Meilleur du lot, en remplaçant ma ligne serveur par mes stats locales. */
export function pickWithMine(
  list: Recordman[],
  who: LFIdentity,
  mine: LFStats,
  mineAlreadyInList = false
): Recordman | null {
  const others = mineAlreadyInList ? list.filter((r) => !r.mine) : list;
  const all = [...others];
  if (mine.attempts >= MIN_ATTEMPTS_RECORD) {
    all.push({
      label: who.label,
      pct: mine.makes / mine.attempts,
      best: mine.best,
      attempts: mine.attempts,
      mine: true,
    });
  }
  if (all.length === 0) return null;
  all.sort((a, b) => b.pct - a.pct || b.best - a.best || b.attempts - a.attempts);
  return all[0];
}

// ─── Record de série : qui détient la plus longue série, tous joueurs confondus ───────────────

export interface StreakRecord {
  label: string; // prénom du détenteur
  best: number;
  mine: boolean;
}

const STREAK_KEY = "lf-streak-record";

function loadCachedStreakRecord(): { label: string; best: number } | null {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    return raw ? (JSON.parse(raw) as { label: string; best: number }) : null;
  } catch {
    return null;
  }
}

/** Détenteur du record de série. Hors ligne : dernier record connu, sinon rien. */
export async function fetchStreakRecord(who: LFIdentity): Promise<{ label: string; best: number; id: string | null } | null> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("joueuse_id,prenom,best_streak")
      .gt("best_streak", 0)
      .order("best_streak", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("offline");
    if (!data) return null;
    const top = { label: String(data.prenom), best: data.best_streak as number, id: String(data.joueuse_id) };
    try {
      localStorage.setItem(STREAK_KEY, JSON.stringify({ label: top.label, best: top.best }));
    } catch {
      /* ignoré */
    }
    return top;
  } catch {
    const cached = loadCachedStreakRecord();
    return cached ? { ...cached, id: null } : null;
  }
}

/**
 * Record à afficher : celui du serveur, sauf si ma meilleure série locale (plus fraîche) le bat
 * strictement. À égalité, le premier à l'avoir fait garde le record.
 */
export function pickStreakRecord(
  top: { label: string; best: number; id: string | null } | null,
  who: LFIdentity,
  myBest: number
): StreakRecord | null {
  if (top && top.id === who.id) {
    return { label: who.label, best: Math.max(top.best, myBest), mine: true };
  }
  if (myBest > (top?.best ?? 0)) return { label: who.label, best: myBest, mine: true };
  return top ? { label: top.label, best: top.best, mine: false } : null;
}
