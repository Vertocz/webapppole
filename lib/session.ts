// lib/session.ts
// ─── Session utilisateur persistante ─────────────────────────────────────────
// La session était stockée dans sessionStorage, vidé à chaque fermeture de la
// PWA (surtout sur iOS) : il fallait se reconnecter à chaque ouverture, ce qui
// était impossible hors ligne. Elle vit désormais dans localStorage.

export type UserType = "joueuse" | "staff";

const USER_KEY = "user";
const TYPE_KEY = "type_user";

function safeGet(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storages() {
  if (typeof window === "undefined") return { local: undefined, session: undefined };
  let local: Storage | undefined;
  let session: Storage | undefined;
  try { local = window.localStorage; } catch { /* stockage bloqué */ }
  try { session = window.sessionStorage; } catch { /* stockage bloqué */ }
  return { local, session };
}

/** Utilisateur connecté (ou null). Migre automatiquement une ancienne session. */
export function getSession<T = Record<string, unknown>>(): { user: T; type: UserType } | null {
  const { local, session } = storages();
  let rawUser = safeGet(local, USER_KEY);
  let rawType = safeGet(local, TYPE_KEY);

  // Migration depuis l'ancienne session (sessionStorage)
  if (!rawUser || !rawType) {
    rawUser = safeGet(session, USER_KEY);
    rawType = safeGet(session, TYPE_KEY);
    if (rawUser && rawType) {
      try {
        local?.setItem(USER_KEY, rawUser);
        local?.setItem(TYPE_KEY, rawType);
      } catch { /* ignoré */ }
    }
  }

  if (!rawUser || (rawType !== "joueuse" && rawType !== "staff")) return null;
  try {
    return { user: JSON.parse(rawUser) as T, type: rawType };
  } catch {
    return null;
  }
}

export function getSessionUser<T = Record<string, unknown>>(): T | null {
  return getSession<T>()?.user ?? null;
}

export function getSessionType(): UserType | null {
  return getSession()?.type ?? null;
}

export function setSession(user: unknown, type: UserType) {
  const { local } = storages();
  try {
    local?.setItem(USER_KEY, JSON.stringify(user));
    local?.setItem(TYPE_KEY, type);
  } catch { /* ignoré */ }
}

/** Met à jour l'utilisateur stocké sans changer son type. */
export function updateSessionUser(patch: Record<string, unknown>) {
  const s = getSession();
  if (!s) return;
  setSession({ ...s.user, ...patch }, s.type);
}

/** Déconnexion : efface la session et les données mises en cache localement. */
export async function clearSession() {
  const { local, session } = storages();
  try {
    local?.removeItem(USER_KEY);
    local?.removeItem(TYPE_KEY);
  } catch { /* ignoré */ }
  try { session?.clear(); } catch { /* ignoré */ }
  try {
    const { clearOfflineData } = await import("./offline");
    await clearOfflineData();
  } catch { /* ignoré */ }
}
