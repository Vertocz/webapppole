import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Bilans hebdomadaires envoyés par mail le lundi matin (cron Vercel) :
//  1. « Forme & suivi sportif » : un mail par pôle, aux membres du staff du pôle
//     qui ont un e-mail renseigné (table staff, colonne email).
//  2. « Préparation mentale » : un mail (les deux pôles) à PREPA_MENTALE_EMAIL.
// Période couverte : les 7 jours qui précèdent le jour d'envoi (lundi → dimanche).
// Aperçu sans envoi : /api/cron/bilan-hebdo?apercu=1&secret=CRON_SECRET (destinataires et sujets)
//                     /api/cron/bilan-hebdo?voir=masculin|feminin|mentale&secret=CRON_SECRET (le mail en HTML)

export const dynamic = "force-dynamic";

type Pole = "masculin" | "feminin";
const CATEGORIE: Record<Pole, string> = { masculin: "Masculin", feminin: "Féminin" };
const NOM_POLE: Record<Pole, string> = { masculin: "Pôle masculin (Poitiers)", feminin: "Pôle féminin (Nantes)" };

interface Joueur { id: string; prenom: string; nom: string; categorie?: string }
interface Forme { joueuse_id: string; date: string; fatigue: number; sommeil: number; douleur: number; stress: number; humeur: number; commentaire?: string | null }
interface Activite { joueuse_id: string; date: string; sport: string; duree: string; difficulte: number; plaisir: number; commentaire?: string | null }
interface Emotion { joueur_id: string; date: string; emotion_nom: string; intensite: number; declencheur?: string | null; ressources?: string | null }
interface Respiration { joueur_id: string; date: string; contexte: string; exercice: string; commentaire?: string | null; moment?: string | null; temps?: string | null }
interface Mail { to: string[]; subject: string; html: string }

// ─── Dates (fuseau Europe/Paris) ─────────────────────────────────────────────
function todayParis(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function jourFr(iso: string, avecJour = true): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC", day: "numeric", month: "long", ...(avecJour ? { weekday: "short" } : {}),
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// ─── HTML ────────────────────────────────────────────────────────────────────
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const nomComplet = (j: Joueur) => `${j.prenom} ${j.nom ?? ""}`.trim();
const prenomsListe = (js: Joueur[]) => js.map(nomComplet).join(", ");

const C = { texte: "#1f2937", gris: "#6b7280", bord: "#e5e7eb", fond: "#f9fafb", rouge: "#b91c1c", orange: "#c2410c", vert: "#15803d" };

function page(titre: string, sousTitre: string, contenu: string): string {
  return `<!DOCTYPE html><html lang="fr"><body style="margin:0;padding:0;background:#f3f4f6;">
<div style="max-width:680px;margin:0 auto;padding:20px 12px;font-family:Arial,Helvetica,sans-serif;color:${C.texte};font-size:14px;line-height:1.45;">
<h1 style="font-size:20px;margin:0 0 4px;">${esc(titre)}</h1>
<p style="margin:0 0 18px;color:${C.gris};">${esc(sousTitre)}</p>
${contenu}
<p style="margin:24px 0 0;color:${C.gris};font-size:12px;">Mail envoyé automatiquement chaque lundi par l'app ParaBasket Pôle.</p>
</div></body></html>`;
}
const carte = (titre: string, contenu: string) =>
  `<div style="background:#fff;border:1px solid ${C.bord};border-radius:10px;padding:14px 16px;margin:0 0 12px;">
<h2 style="font-size:16px;margin:0 0 10px;">${esc(titre)}</h2>${contenu}</div>`;
const sousTitre = (t: string) => `<p style="margin:10px 0 6px;font-weight:bold;">${t}</p>`;
const vide = (t: string) => `<p style="margin:4px 0;color:${C.gris};font-style:italic;">${esc(t)}</p>`;
const blocRien = (js: Joueur[], quoi: string) =>
  js.length === 0
    ? `<p style="margin:16px 0 0;color:${C.vert};">✅ Tout le monde a rempli ${esc(quoi)} cette semaine.</p>`
    : `<div style="margin:16px 0 0;padding:12px 16px;background:${C.fond};border:1px dashed ${C.bord};border-radius:10px;">
<b>Rien de saisi cette semaine</b> (${js.length}) : ${esc(prenomsListe(js))}.</div>`;

// ─── Forme : indicateurs notés de 1 à 5 ──────────────────────────────────────
// sensDefavorable : "haut" = une note élevée est mauvaise (fatigue, douleurs, stress)
const INDICATEURS: { cle: keyof Forme; label: string; sensDefavorable: "haut" | "bas" }[] = [
  { cle: "fatigue", label: "😴 Fatigue", sensDefavorable: "haut" },
  { cle: "sommeil", label: "🛌 Sommeil", sensDefavorable: "bas" },
  { cle: "douleur", label: "🤕 Douleurs", sensDefavorable: "haut" },
  { cle: "stress", label: "😰 Stress", sensDefavorable: "haut" },
  { cle: "humeur", label: "😊 Humeur", sensDefavorable: "bas" },
];
function couleurNote(v: number, sens: "haut" | "bas"): string {
  const mauvais = sens === "haut" ? v : 6 - v; // ramène à « plus c'est haut, plus c'est mauvais »
  return mauvais >= 4 ? C.rouge : mauvais >= 3.5 ? C.orange : C.texte;
}

function sectionForme(saisies: Forme[]): string {
  if (saisies.length === 0) return vide("Pas de suivi de forme rempli.");
  const cellules = INDICATEURS.map(({ cle, label, sensDefavorable }) => {
    const vals = saisies.map((s) => Number(s[cle]));
    const moy = vals.reduce((a, b) => a + b, 0) / vals.length;
    const pire = sensDefavorable === "haut" ? Math.max(...vals) : Math.min(...vals);
    const detail = vals.length > 1 ? `<br><span style="color:${C.gris};font-size:12px;">pire : ${pire}/5</span>` : "";
    return `<td style="padding:6px;border:1px solid ${C.bord};text-align:center;vertical-align:top;">
<div style="font-size:12px;color:${C.gris};">${label}</div>
<div style="font-weight:bold;font-size:15px;color:${couleurNote(moy, sensDefavorable)};">${moy.toFixed(1).replace(".", ",")}/5</div>${detail}</td>`;
  }).join("");
  const commentaires = saisies
    .filter((s) => s.commentaire && s.commentaire.trim())
    .map((s) => `<li><span style="color:${C.gris};">${esc(jourFr(s.date))} :</span> ${esc(s.commentaire)}</li>`)
    .join("");
  return `<p style="margin:0 0 6px;color:${C.gris};font-size:12px;">Moyenne sur ${saisies.length} saisie${saisies.length > 1 ? "s" : ""}</p>
<table style="border-collapse:collapse;width:100%;table-layout:fixed;"><tr>${cellules}</tr></table>
${commentaires ? `<ul style="margin:8px 0 0;padding-left:18px;">${commentaires}</ul>` : ""}`;
}

function sectionSportif(seances: Activite[]): string {
  if (seances.length === 0) return vide("Pas de séance saisie.");
  const lignes = seances.map((a) => `<tr>
<td style="padding:5px 6px;border-bottom:1px solid ${C.bord};white-space:nowrap;color:${C.gris};">${esc(jourFr(a.date))}</td>
<td style="padding:5px 6px;border-bottom:1px solid ${C.bord};"><b>${esc(a.sport)}</b>${a.commentaire?.trim() ? `<br><span style="color:${C.gris};">${esc(a.commentaire)}</span>` : ""}</td>
<td style="padding:5px 6px;border-bottom:1px solid ${C.bord};white-space:nowrap;">⏱ ${esc(a.duree)}</td>
<td style="padding:5px 6px;border-bottom:1px solid ${C.bord};white-space:nowrap;">💪 ${a.difficulte}/10</td>
<td style="padding:5px 6px;border-bottom:1px solid ${C.bord};white-space:nowrap;">😄 ${a.plaisir}/10</td></tr>`).join("");
  return `<p style="margin:0 0 6px;color:${C.gris};font-size:12px;">${seances.length} séance${seances.length > 1 ? "s" : ""}</p>
<table style="border-collapse:collapse;width:100%;font-size:13px;">${lignes}</table>`;
}

function mailFormeSportif(pole: Pole, joueurs: Joueur[], formes: Forme[], activites: Activite[], debut: string, fin: string): Omit<Mail, "to"> {
  const cartes: string[] = [];
  const rien: Joueur[] = [];
  for (const j of joueurs) {
    const f = formes.filter((x) => x.joueuse_id === j.id);
    const a = activites.filter((x) => x.joueuse_id === j.id);
    if (f.length === 0 && a.length === 0) { rien.push(j); continue; }
    cartes.push(carte(nomComplet(j), sousTitre("Forme") + sectionForme(f) + sousTitre("Suivi sportif") + sectionSportif(a)));
  }
  const periode = `Semaine du ${jourFr(debut, false)} au ${jourFr(fin, false)}`;
  return {
    subject: `Bilan forme & sportif — ${NOM_POLE[pole]} — ${periode.toLowerCase()}`,
    html: page(`Forme & suivi sportif — ${NOM_POLE[pole]}`, periode, cartes.join("") + blocRien(rien, "son suivi")),
  };
}

// ─── Préparation mentale ─────────────────────────────────────────────────────
const CONTEXTE: Record<string, string> = { activation: "Activation", relaxation: "Relaxation", scan: "Scan corporel" };

function sectionEmotions(es: Emotion[]): string {
  if (es.length === 0) return vide("Pas de scan émotionnel.");
  return `<ul style="margin:0;padding-left:18px;">${es.map((e) => `<li style="margin:0 0 6px;">
<span style="color:${C.gris};">${esc(jourFr(e.date))} :</span> <b>${esc(e.emotion_nom)}</b> (intensité ${esc(e.intensite)})
${e.declencheur?.trim() ? `<br>Déclencheur : ${esc(e.declencheur)}` : ""}
${e.ressources?.trim() ? `<br>Ressources : ${esc(e.ressources)}` : ""}</li>`).join("")}</ul>`;
}

function sectionRespiration(rs: Respiration[]): string {
  if (rs.length === 0) return vide("Pas d'exercice de respiration.");
  return `<ul style="margin:0;padding-left:18px;">${rs.map((r) => {
    const infos = [r.moment, r.temps].filter((x) => x && String(x).trim()).map(esc).join(" · ");
    return `<li style="margin:0 0 6px;"><span style="color:${C.gris};">${esc(jourFr(r.date))} :</span>
<b>${esc(r.exercice)}</b> (${esc(CONTEXTE[r.contexte] ?? r.contexte)})${infos ? ` — ${infos}` : ""}
${r.commentaire?.trim() ? `<br>${esc(r.commentaire)}` : ""}</li>`;
  }).join("")}</ul>`;
}

function mailPrepaMentale(joueurs: Joueur[], emotions: Emotion[], respirations: Respiration[], debut: string, fin: string): Omit<Mail, "to"> {
  const sections = (["masculin", "feminin"] as Pole[]).map((pole) => {
    const duPole = joueurs.filter((j) => j.categorie === CATEGORIE[pole]);
    const cartes: string[] = [];
    const rien: Joueur[] = [];
    for (const j of duPole) {
      const e = emotions.filter((x) => x.joueur_id === j.id);
      const r = respirations.filter((x) => x.joueur_id === j.id);
      if (e.length === 0 && r.length === 0) { rien.push(j); continue; }
      cartes.push(carte(nomComplet(j), sousTitre("Émotions") + sectionEmotions(e) + sousTitre("Respiration") + sectionRespiration(r)));
    }
    return `<h2 style="font-size:18px;margin:22px 0 10px;">${esc(NOM_POLE[pole])}</h2>${cartes.join("")}${blocRien(rien, "sa prépa mentale")}`;
  }).join("");
  const periode = `Semaine du ${jourFr(debut, false)} au ${jourFr(fin, false)}`;
  return {
    subject: `Bilan préparation mentale — ${periode.toLowerCase()}`,
    html: page("Préparation mentale — Pôles France", periode, sections),
  };
}

// ─── Envoi ───────────────────────────────────────────────────────────────────
async function envoyer(mail: Mail): Promise<{ ok: boolean; erreur?: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM ?? "ParaBasket Pôle <onboarding@resend.dev>",
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      ...(process.env.MAIL_REPLY_TO ? { reply_to: process.env.MAIL_REPLY_TO } : {}),
    }),
  });
  return res.ok ? { ok: true } : { ok: false, erreur: `${res.status} ${await res.text()}` };
}

const listeAdresses = (s?: string | null) =>
  (s ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter((x) => x.includes("@"));

export async function GET(req: NextRequest) {
  const apercu = req.nextUrl.searchParams.has("apercu");
  const voir = req.nextUrl.searchParams.get("voir"); // "masculin" | "feminin" | "mentale" → renvoie le HTML
  const secret = process.env.CRON_SECRET;
  const parEntete = !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
  // ?secret=… accepté uniquement pour regarder (aperçu / voir), jamais pour envoyer
  const parUrl = !!secret && (apercu || !!voir) && req.nextUrl.searchParams.get("secret") === secret;
  if (!parEntete && !parUrl) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const aujourdhui = todayParis();
  const debut = addDays(aujourdhui, -7);
  const fin = addDays(aujourdhui, -1);

  const [joueursR, staffR, formesR, activitesR, emotionsR, respirationsR] = await Promise.all([
    sb.from("joueuses").select("id, prenom, nom, categorie").order("prenom"),
    sb.from("staff").select("prenom, nom, email, masculin, feminin"),
    sb.from("suivi_forme").select("joueuse_id, date, fatigue, sommeil, douleur, stress, humeur, commentaire").gte("date", debut).lte("date", fin).order("date"),
    sb.from("activites").select("joueuse_id, date, sport, duree, difficulte, plaisir, commentaire").gte("date", debut).lte("date", fin).order("date"),
    sb.from("suivi_emotions").select("joueur_id, date, emotion_nom, intensite, declencheur, ressources").gte("date", debut).lte("date", fin).order("date"),
    sb.from("suivi_respiration").select("joueur_id, date, contexte, exercice, commentaire, moment, temps").gte("date", debut).lte("date", fin).order("date"),
  ]);
  const erreurLecture = [joueursR, staffR, formesR, activitesR, emotionsR, respirationsR].find((r) => r.error)?.error;
  if (erreurLecture) return NextResponse.json({ ok: false, erreur: erreurLecture.message }, { status: 500 });

  const joueurs = (joueursR.data ?? []) as Joueur[];
  const staff = (staffR.data ?? []) as { email?: string | null; masculin?: boolean; feminin?: boolean }[];

  const mails: (Mail & { cle: string })[] = [];
  for (const pole of ["masculin", "feminin"] as Pole[]) {
    const to = [...new Set(staff.filter((s) => s[pole]).flatMap((s) => listeAdresses(s.email)))];
    const duPole = joueurs.filter((j) => j.categorie === CATEGORIE[pole]);
    mails.push({ cle: pole, to, ...mailFormeSportif(pole, duPole, (formesR.data ?? []) as Forme[], (activitesR.data ?? []) as Activite[], debut, fin) });
  }
  mails.push({
    cle: "mentale",
    to: listeAdresses(process.env.PREPA_MENTALE_EMAIL),
    ...mailPrepaMentale(joueurs, (emotionsR.data ?? []) as Emotion[], (respirationsR.data ?? []) as Respiration[], debut, fin),
  });

  if (voir) {
    const m = mails.find((x) => x.cle === voir);
    if (!m) return NextResponse.json({ error: "voir = masculin | feminin | mentale" }, { status: 400 });
    return new NextResponse(m.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const resultats: Record<string, unknown> = {};
  for (const m of mails) {
    if (m.to.length === 0) { resultats[m.cle] = { envoye: false, raison: "aucun destinataire" }; continue; }
    if (apercu) { resultats[m.cle] = { envoye: false, apercu: true, to: m.to, sujet: m.subject }; continue; }
    const r = await envoyer(m);
    resultats[m.cle] = { envoye: r.ok, to: m.to, ...(r.erreur ? { erreur: r.erreur } : {}) };
  }
  return NextResponse.json({ ok: true, periode: { debut, fin }, resultats });
}
