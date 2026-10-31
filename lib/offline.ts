// lib/offline.ts
// ─── Mode hors ligne ─────────────────────────────────────────────────────────
// 1. Cache de lecture : chaque réponse GET de Supabase est gardée dans
//    IndexedDB et resservie quand le réseau ne répond pas (voir lib/supabase.ts).
// 2. File d'attente (« outbox ») : les enregistrements faits sans réseau sont
//    stockés localement puis envoyés automatiquement au retour du réseau.

"use client";

import { useEffect, useState } from "react";

const DB_NAME = "parabasket-offline";
const DB_VERSION = 1;
const STORE_CACHE = "cache";
const STORE_OUTBOX = "outbox";

/** Événement émis après l'envoi de la file : detail = SyncResult */
export const SYNC_EVENT = "parabasket:sync";
/** Événement émis quand la file change (ajout, envoi, suppression) */
export const OUTBOX_EVENT = "parabasket:outbox";

const CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 45; // 45 jours
const CACHE_MAX_ENTRIES = 400;

// ─── IndexedDB minimaliste ───────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB indisponible"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        const s = db.createObjectStore(STORE_CACHE, { keyPath: "key" });
        s.createIndex("loose", "loose");
        s.createIndex("ts", "ts");
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(name, mode);
  const result = await fn(tx.objectStore(name));
  const value = result instanceof IDBRequest ? await reqToPromise(result) : result;
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return value;
}

// ─── Statut réseau ───────────────────────────────────────────────────────────

export function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/** Hook : true quand l'appareil est connecté. */
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

// ─── Cache de lecture (réponses HTTP Supabase) ───────────────────────────────

export interface CachedResponse {
  key: string;
  /** Même clé sans les dates : permet de retrouver une réponse le lendemain */
  loose: string;
  ts: number;
  status: number;
  body: string;
  headers: Record<string, string>;
}

/** Les requêtes « 30 derniers jours » contiennent la date du jour : on la neutralise. */
export function looseKey(key: string) {
  return key.replace(/\d{4}-\d{2}-\d{2}(T[\d:.%A-Z+-]*)?/g, "*");
}

export async function putCachedResponse(entry: Omit<CachedResponse, "loose" | "ts">) {
  try {
    await withStore(STORE_CACHE, "readwrite", (s) =>
      s.put({ ...entry, loose: looseKey(entry.key), ts: Date.now() })
    );
  } catch { /* cache best-effort */ }
}

export async function getCachedResponse(key: string): Promise<CachedResponse | null> {
  try {
    const exact = await withStore<CachedResponse | undefined>(STORE_CACHE, "readonly", (s) => s.get(key));
    if (exact) return exact;
    const all = await withStore<CachedResponse[]>(STORE_CACHE, "readonly", (s) =>
      s.index("loose").getAll(looseKey(key))
    );
    if (!all.length) return null;
    return all.sort((a, b) => b.ts - a.ts)[0];
  } catch {
    return null;
  }
}

/** Supprime les entrées trop anciennes ou en surnombre. */
export async function pruneCache() {
  try {
    const all = await withStore<CachedResponse[]>(STORE_CACHE, "readonly", (s) => s.getAll());
    const now = Date.now();
    const sorted = [...all].sort((a, b) => b.ts - a.ts);
    const toDelete = sorted.filter((e, i) => i >= CACHE_MAX_ENTRIES || now - e.ts > CACHE_MAX_AGE);
    if (!toDelete.length) return;
    await withStore(STORE_CACHE, "readwrite", async (s) => {
      toDelete.forEach((e) => s.delete(e.key));
      return undefined;
    });
  } catch { /* ignoré */ }
}

// ─── File d'attente des écritures ────────────────────────────────────────────

export type OutboxAction = "insert" | "update" | "delete";

export interface OutboxOp {
  id: string;
  table: string;
  action: OutboxAction;
  /** insert : ligne(s) à insérer ; update : champs modifiés */
  payload?: Record<string, unknown> | Record<string, unknown>[];
  /** update / delete : id de la ligne visée */
  rowId?: string;
  /** Nouvelle entrée donnant droit aux récompenses (carte, badges) : id du bénéficiaire */
  reward?: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface SyncResult {
  sent: number;
  rewarded: number;
  failed: number;
  tables: string[];
}

export const PENDING_PREFIX = "pending-";

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function notifyOutbox() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OUTBOX_EVENT));
}

export async function getOutbox(): Promise<OutboxOp[]> {
  try {
    const all = await withStore<OutboxOp[]>(STORE_OUTBOX, "readonly", (s) => s.getAll());
    return all.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

async function putOp(op: OutboxOp) {
  await withStore(STORE_OUTBOX, "readwrite", (s) => s.put(op));
  notifyOutbox();
}

async function deleteOp(id: string) {
  await withStore(STORE_OUTBOX, "readwrite", (s) => s.delete(id));
  notifyOutbox();
}

/** Erreur réseau (et non erreur de la base de données) ? */
export function isNetworkFailure(res: { status?: number; error?: unknown } | null | undefined) {
  if (!isOnline()) return true;
  return !!res && res.status === 0;
}

async function runOp(op: OutboxOp) {
  const { supabase } = await import("./supabase");
  const q = supabase.from(op.table);
  if (op.action === "insert") return q.insert(op.payload as never);
  if (op.action === "update") return q.update(op.payload as never).eq("id", op.rowId!);
  return q.delete().eq("id", op.rowId!);
}

export interface WriteResult {
  /** Enregistré localement, sera envoyé plus tard */
  queued: boolean;
  /** Erreur renvoyée par la base (hors problème réseau) */
  error: { message: string } | null;
}

/**
 * Écrit dans Supabase, ou met l'opération en file d'attente sans réseau.
 * Modifier / supprimer une entrée encore en attente agit directement sur la file.
 */
export async function writeOrQueue(
  table: string,
  action: OutboxAction,
  opts: { payload?: OutboxOp["payload"]; rowId?: string; reward?: string } = {}
): Promise<WriteResult> {
  // Entrée pas encore envoyée : on modifie la file plutôt que la base
  if (opts.rowId?.startsWith(PENDING_PREFIX)) {
    const [opId, idxStr] = opts.rowId.slice(PENDING_PREFIX.length).split("#");
    const idx = idxStr === undefined ? null : Number(idxStr);
    const ops = await getOutbox();
    const op = ops.find((o) => o.id === opId);
    if (op && op.payload) {
      const patch = (opts.payload ?? {}) as Record<string, unknown>;
      if (Array.isArray(op.payload) && idx !== null) {
        const rows = [...op.payload];
        if (action === "delete") rows.splice(idx, 1);
        else if (action === "update") rows[idx] = { ...rows[idx], ...patch };
        if (rows.length) await putOp({ ...op, payload: rows });
        else await deleteOp(op.id);
      } else if (action === "delete") {
        await deleteOp(op.id);
      } else if (action === "update" && !Array.isArray(op.payload)) {
        await putOp({ ...op, payload: { ...op.payload, ...patch } });
      }
    }
    return { queued: true, error: null };
  }

  const op: OutboxOp = {
    id: newId(),
    table,
    action,
    payload: opts.payload,
    rowId: opts.rowId,
    reward: opts.reward,
    createdAt: Date.now(),
    attempts: 0,
  };

  if (isOnline()) {
    const res = await runOp(op);
    if (!isNetworkFailure(res)) {
      return { queued: false, error: res.error ? { message: res.error.message } : null };
    }
  }

  try {
    await putOp(op);
    return { queued: true, error: null };
  } catch {
    return { queued: false, error: { message: "Impossible d'enregistrer hors ligne sur cet appareil." } };
  }
}

const MAX_ATTEMPTS = 5;
let flushing: Promise<SyncResult> | null = null;

/** Envoie la file d'attente, dans l'ordre. S'arrête à la première panne réseau. */
export function flushOutbox(): Promise<SyncResult> {
  if (flushing) return flushing;
  flushing = (async () => {
    const result: SyncResult = { sent: 0, rewarded: 0, failed: 0, tables: [] };
    if (!isOnline()) return result;
    const ops = await getOutbox();
    for (const op of ops) {
      if (op.attempts >= MAX_ATTEMPTS) { result.failed++; continue; }
      let res;
      try {
        res = await runOp(op);
      } catch {
        break;
      }
      if (isNetworkFailure(res)) break;
      if (res.error) {
        await putOp({ ...op, attempts: op.attempts + 1, lastError: res.error.message });
        result.failed++;
        continue;
      }
      await deleteOp(op.id);
      result.sent++;
      if (op.reward) { result.rewarded++; addPendingReward(op.reward); }
      if (!result.tables.includes(op.table)) result.tables.push(op.table);
    }
    if (result.sent > 0 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent<SyncResult>(SYNC_EVENT, { detail: result }));
    }
    return result;
  })().finally(() => { flushing = null; });
  return flushing;
}

// ─── Récompenses gagnées pendant la synchro ──────────────────────────────────
// La synchro peut avoir lieu avant que l'écran joueur soit prêt : les cartes
// dues sont mémorisées puis distribuées par l'écran joueur.

const REWARDS_KEY = "parabasket:pending-rewards";

function readRewards(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(REWARDS_KEY) ?? "{}"); } catch { return {}; }
}

function addPendingReward(userId: string) {
  try {
    const r = readRewards();
    r[userId] = (r[userId] ?? 0) + 1;
    localStorage.setItem(REWARDS_KEY, JSON.stringify(r));
  } catch { /* ignoré */ }
}

/** Récupère (et remet à zéro) le nombre de récompenses dues à cet utilisateur. */
export function consumePendingRewards(userId: string): number {
  try {
    const r = readRewards();
    const n = r[userId] ?? 0;
    if (n) { delete r[userId]; localStorage.setItem(REWARDS_KEY, JSON.stringify(r)); }
    return n;
  } catch {
    return 0;
  }
}

/** Abandonne les opérations refusées par la base après plusieurs essais. */
export async function discardFailedOps() {
  const ops = await getOutbox();
  await Promise.all(ops.filter((o) => o.attempts >= MAX_ATTEMPTS).map((o) => deleteOp(o.id)));
}

/**
 * Fusionne les écritures en attente dans une liste chargée (cache ou réseau) :
 * ajoute les nouvelles entrées, applique les modifications, retire les suppressions.
 * Les entrées en attente reçoivent `_pending: true`.
 */
export async function applyPending<T extends { id: string }>(
  rows: T[],
  table: string,
  userColumn: string,
  userId: string
): Promise<(T & { _pending?: boolean })[]> {
  const ops = (await getOutbox()).filter((o) => o.table === table);
  if (!ops.length) return rows;
  let out: (T & { _pending?: boolean })[] = [...rows];
  for (const op of ops) {
    if (op.action === "insert") {
      const payloads = Array.isArray(op.payload) ? op.payload : [op.payload ?? {}];
      payloads.forEach((p, i) => {
        if (String(p[userColumn]) !== String(userId)) return;
        out.unshift({
          ...(p as unknown as T),
          id: `${PENDING_PREFIX}${op.id}${payloads.length > 1 ? `#${i}` : ""}`,
          _pending: true,
        });
      });
    } else if (op.action === "update") {
      out = out.map((r) => (r.id === op.rowId ? { ...r, ...(op.payload as object), _pending: true } : r));
    } else {
      out = out.filter((r) => r.id !== op.rowId);
    }
  }
  return out;
}

/** Hook : nombre d'opérations en attente (et en échec). */
export function useOutboxCount() {
  const [count, setCount] = useState({ pending: 0, failed: 0 });
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      getOutbox().then((ops) => {
        if (!alive) return;
        const failed = ops.filter((o) => o.attempts >= MAX_ATTEMPTS).length;
        setCount({ pending: ops.length - failed, failed });
      });
    refresh();
    window.addEventListener(OUTBOX_EVENT, refresh);
    return () => { alive = false; window.removeEventListener(OUTBOX_EVENT, refresh); };
  }, []);
  return count;
}

/** Hook : relance `fn` après chaque synchronisation touchant une des tables. */
export function useOnSync(tables: string[], fn: () => void) {
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<SyncResult>).detail;
      if (!detail || detail.tables.some((t) => tables.includes(t))) fn();
    };
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, [fn, tables.join("|")]);
}

/** Déclenche l'envoi de la file au retour du réseau / au retour dans l'app. */
export function startOfflineSync() {
  if (typeof window === "undefined") return () => {};
  // Juste après le retour du réseau, la connexion n'est souvent pas encore
  // utilisable : on réessaie rapidement (2 s, 5 s, 15 s, 30 s).
  const RETRY_DELAYS = [2000, 5000, 15000, 30000];
  let retry = 0;
  let retryTimer: number | undefined;

  const flush = async () => {
    window.clearTimeout(retryTimer);
    if (!isOnline()) return;
    await flushOutbox();
    const left = (await getOutbox()).some((o) => o.attempts < MAX_ATTEMPTS);
    if (left && isOnline() && retry < RETRY_DELAYS.length) {
      retryTimer = window.setTimeout(flush, RETRY_DELAYS[retry++]);
    } else if (!left) {
      retry = 0;
    }
  };
  const onOnline = () => { retry = 0; flush(); };
  const onVisible = () => { if (document.visibilityState === "visible") onOnline(); };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  const interval = window.setInterval(flush, 60_000);
  flush();
  pruneCache();
  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(interval);
    window.clearTimeout(retryTimer);
  };
}

/** Efface toutes les données locales (déconnexion). La file non envoyée est conservée. */
export async function clearOfflineData() {
  try {
    await withStore(STORE_CACHE, "readwrite", (s) => s.clear());
  } catch { /* ignoré */ }
  try {
    if ("caches" in window) await caches.delete(BILLETS_CACHE);
  } catch { /* ignoré */ }
}

// ─── Billets PDF hors ligne ──────────────────────────────────────────────────

export const BILLETS_CACHE = "parabasket-billets";

/** Garde en cache exactement ces PDF (télécharge les manquants, supprime les autres). */
export async function syncBilletsPdf(urls: string[]): Promise<Set<string>> {
  const available = new Set<string>();
  if (typeof window === "undefined" || !("caches" in window)) return available;
  try {
    const cache = await caches.open(BILLETS_CACHE);
    const keys = await cache.keys();
    const wanted = new Set(urls);
    await Promise.all(keys.filter((k) => !wanted.has(k.url)).map((k) => cache.delete(k)));
    await Promise.all(
      urls.map(async (url) => {
        if (await cache.match(url)) { available.add(url); return; }
        if (!isOnline()) return;
        try {
          const res = await fetch(url, { mode: "cors", cache: "no-store" });
          if (res.ok) { await cache.put(url, res); available.add(url); }
        } catch { /* réessayé à la prochaine ouverture */ }
      })
    );
  } catch { /* ignoré */ }
  return available;
}

export async function getCachedBilletPdf(url: string): Promise<Blob | null> {
  try {
    const cache = await caches.open(BILLETS_CACHE);
    const res = await cache.match(url);
    return res ? await res.blob() : null;
  } catch {
    return null;
  }
}

// ─── Médias (audios de respiration) ──────────────────────────────────────────

const MEDIA_CACHE = "parabasket-media";

/** Télécharge un média en entier dans le cache (en arrière-plan). */
export async function cacheMedia(url: string) {
  try {
    if (!("caches" in window)) return;
    const cache = await caches.open(MEDIA_CACHE);
    if (await cache.match(url)) return;
    const res = await fetch(url, { mode: "cors" });
    if (res.ok && res.status === 200) await cache.put(url, res);
  } catch { /* ignoré */ }
}

/** URL locale (blob:) d'un média gardé en cache, ou null. */
export async function getCachedMediaUrl(url: string): Promise<string | null> {
  try {
    if (!("caches" in window)) return null;
    const res = await (await caches.open(MEDIA_CACHE)).match(url);
    return res ? URL.createObjectURL(await res.blob()) : null;
  } catch {
    return null;
  }
}
