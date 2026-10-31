// lib/dates.ts
// ─── Dates au format "YYYY-MM-DD" dans le fuseau de l'appareil ───────────────
// `new Date().toISOString().split("T")[0]` donne la date UTC : en France, une
// saisie faite entre minuit et 1 h (2 h l'été) était proposée à la veille, et
// les séries de jours se cassaient au changement d'heure.

const pad = (n: number) => String(n).padStart(2, "0");

/** Date locale d'un objet Date → "YYYY-MM-DD". */
export function toLocalISODate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Aujourd'hui (date locale). */
export function todayISO(): string {
  return toLocalISODate(new Date());
}

/** Il y a `n` jours (date locale). */
export function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toLocalISODate(d);
}

/** Ajoute `n` jours à une date "YYYY-MM-DD" (sans effet de fuseau ni d'heure d'été). */
export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
