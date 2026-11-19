import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

// Bilans hebdomadaires envoyés par mail le lundi matin (cron Vercel) :
//  1. « Forme & suivi sportif » : un mail par pôle, aux membres du staff du pôle
//     cochés bilan_hebdo et qui ont un e-mail renseigné (table staff).
//     Chaque pôle ne reçoit que les joueurs·ses de sa catégorie.
//  2. « Préparation mentale » (pôle masculin uniquement) : aux membres du staff cochés bilan_mental.
// Période couverte : les 7 jours qui précèdent le jour d'envoi (lundi → dimanche).
// Aperçu sans envoi : /api/cron/bilan-hebdo?apercu=1&secret=CRON_SECRET (destinataires et sujets)
//                     /api/cron/bilan-hebdo?voir=masculin|feminin|mentale&secret=CRON_SECRET (le mail en HTML)

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Pole = "masculin" | "feminin";
const CATEGORIE: Record<Pole, string> = { masculin: "Masculin", feminin: "Féminin" };
const NOM_POLE: Record<Pole, string> = { masculin: "Pôle masculin", feminin: "Pôle féminin" };

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
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").trim().replace(/\n/g, "<br>");
const nomComplet = (j: Joueur) => `${j.prenom} ${j.nom ?? ""}`.trim();
const prenomsListe = (js: Joueur[]) => js.map(nomComplet).join(", ");

const C = { texte: "#1f2937", gris: "#64748b", bord: "#e2e8f0", fond: "#f1f5f9", marine: "#16324f", vert: "#166534" };
const TON = {
  neutre: { bg: "#f1f5f9", fg: "#1f2937" },
  orange: { bg: "#ffedd5", fg: "#9a3412" },
  rouge: { bg: "#fee2e2", fg: "#991b1b" },
};
type Ton = keyof typeof TON;
const pastille = (texte: string, ton: Ton = "neutre") =>
  `<span style="display:inline-block;white-space:nowrap;margin:3px 4px 0 0;padding:3px 9px;border-radius:12px;background:${TON[ton].bg};color:${TON[ton].fg};font-size:13px;font-weight:bold;">${texte}</span>`;

function page(titre: string, periode: string, legende: string, contenu: string): string {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef2f6;">
<div style="max-width:600px;margin:0 auto;padding:16px 10px;font-family:Arial,Helvetica,sans-serif;color:${C.texte};font-size:14px;line-height:1.45;">
<div style="background:${C.marine};color:#ffffff;border-radius:12px 12px 0 0;padding:18px 18px 14px;">
<div style="font-size:19px;font-weight:bold;">${esc(titre)}</div>
<div style="font-size:13px;opacity:.85;margin-top:2px;">${esc(periode)}</div></div>
<div style="background:#ffffff;border-radius:0 0 12px 12px;padding:10px 18px;margin:0 0 14px;font-size:12px;color:${C.gris};">${legende}</div>
${contenu}
</div></body></html>`;
}
const carte = (titre: string, contenu: string) =>
  `<div style="background:#ffffff;border-radius:12px;padding:14px 16px 10px;margin:0 0 12px;border-left:4px solid ${C.marine};">
<div style="font-size:16px;font-weight:bold;margin:0 0 2px;">${esc(titre)}</div>${contenu}</div>`;
const rubrique = (t: string) =>
  `<div style="margin:12px 0 2px;font-size:11px;font-weight:bold;letter-spacing:1px;color:${C.gris};text-transform:uppercase;">${esc(t)}</div>`;
const entree = (date: string, corps: string, commentaire?: string | null) =>
  `<div style="padding:7px 0;border-top:1px solid ${C.bord};">
<div style="font-size:12px;color:${C.gris};">${esc(jourFr(date))}</div>${corps}
${commentaire?.trim() ? `<div style="margin-top:4px;color:#475569;font-style:italic;">💬 ${esc(commentaire)}</div>` : ""}</div>`;
const vide = (t: string) => `<div style="padding:6px 0;border-top:1px solid ${C.bord};color:${C.gris};font-style:italic;">${esc(t)}</div>`;
const blocRien = (js: Joueur[], quoi: string, quand: string) =>
  js.length === 0
    ? `<div style="padding:12px 16px;background:#ffffff;border-radius:12px;color:${C.vert};">✅ Tout le monde a rempli ${esc(quoi)} ${quand}.</div>`
    : `<div style="padding:12px 16px;background:#ffffff;border-radius:12px;">
<b>Rien de saisi ${quand}</b> (${js.length})<br><span style="color:${C.gris};">${esc(prenomsListe(js))}</span></div>`;
const quandPeriode = (debut: string, fin: string) => (addDays(debut, 6) === fin ? "cette semaine" : "sur la période");

// ─── Forme : indicateurs notés de 1 à 5 ──────────────────────────────────────
// sensDefavorable : "haut" = une note élevée est mauvaise (fatigue, douleurs, stress)
const INDICATEURS: { cle: keyof Forme; emoji: string; nom: string; sensDefavorable: "haut" | "bas" }[] = [
  { cle: "fatigue", emoji: "😴", nom: "fatigue", sensDefavorable: "haut" },
  { cle: "sommeil", emoji: "🛌", nom: "sommeil", sensDefavorable: "bas" },
  { cle: "douleur", emoji: "🤕", nom: "douleurs", sensDefavorable: "haut" },
  { cle: "stress", emoji: "😰", nom: "stress", sensDefavorable: "haut" },
  { cle: "humeur", emoji: "😊", nom: "humeur", sensDefavorable: "bas" },
];
function tonNote(v: number, sens: "haut" | "bas"): Ton {
  const mauvais = sens === "haut" ? v : 6 - v; // ramène à « plus c'est haut, plus c'est mauvais »
  return mauvais >= 5 ? "rouge" : mauvais >= 4 ? "orange" : "neutre";
}
const LEGENDE_FORME = `Forme notée sur 5 : ${INDICATEURS.map((i) => `${i.emoji} ${i.nom}`).join(" · ")}.<br>
Séances : ⏱ durée · 💪 difficulté /10 · 😄 plaisir /10. En orange ou rouge : point à surveiller.`;

function sectionForme(saisies: Forme[]): string {
  if (saisies.length === 0) return vide("Pas de suivi de forme rempli.");
  return saisies.map((s) => entree(
    s.date,
    `<div>${INDICATEURS.map(({ cle, emoji, sensDefavorable }) => {
      const v = Number(s[cle]);
      return pastille(`${emoji} ${v}`, tonNote(v, sensDefavorable));
    }).join("")}</div>`,
    s.commentaire,
  )).join("");
}

function sectionSportif(seances: Activite[]): string {
  if (seances.length === 0) return vide("Pas de séance saisie.");
  return seances.map((a) => entree(
    a.date,
    `<div style="font-weight:bold;margin-top:1px;">${esc(a.sport)}</div>
<div>${pastille(`⏱ ${esc(a.duree)}`)}${pastille(`💪 ${a.difficulte}/10`)}${pastille(`😄 ${a.plaisir}/10`)}</div>`,
    a.commentaire,
  )).join("");
}

function mailFormeSportif(pole: Pole, joueurs: Joueur[], formes: Forme[], activites: Activite[], debut: string, fin: string): Omit<Mail, "to"> {
  const cartes: string[] = [];
  const rien: Joueur[] = [];
  for (const j of joueurs) {
    const f = formes.filter((x) => x.joueuse_id === j.id);
    const a = activites.filter((x) => x.joueuse_id === j.id);
    if (f.length === 0 && a.length === 0) { rien.push(j); continue; }
    cartes.push(carte(nomComplet(j), rubrique("Forme") + sectionForme(f) + rubrique("Suivi sportif") + sectionSportif(a)));
  }
  const periode = `${addDays(debut, 6) === fin ? "Semaine du" : "Du"} ${jourFr(debut, false)} au ${jourFr(fin, false)}`;
  return {
    subject: `Bilan forme & sportif — ${NOM_POLE[pole]} — ${periode.toLowerCase()}`,
    html: page(`Forme & suivi sportif — ${NOM_POLE[pole]}`, periode, LEGENDE_FORME, cartes.join("") + blocRien(rien, "son suivi", quandPeriode(debut, fin))),
  };
}

// ─── Préparation mentale ─────────────────────────────────────────────────────
const CONTEXTE: Record<string, string> = { activation: "Activation", relaxation: "Relaxation", scan: "Scan corporel" };

function sectionEmotions(es: Emotion[]): string {
  if (es.length === 0) return vide("Pas de scan émotionnel.");
  return es.map((e) => entree(
    e.date,
    `<div>${pastille(`${esc(e.emotion_nom)} · ${esc(e.intensite)}/5`)}</div>
${e.declencheur?.trim() ? `<div style="margin-top:3px;"><span style="color:${C.gris};">Déclencheur :</span> ${esc(e.declencheur)}</div>` : ""}
${e.ressources?.trim() ? `<div><span style="color:${C.gris};">Ressources :</span> ${esc(e.ressources)}</div>` : ""}`,
  )).join("");
}

function sectionRespiration(rs: Respiration[]): string {
  if (rs.length === 0) return vide("Pas d'exercice de respiration.");
  return rs.map((r) => entree(
    r.date,
    `<div style="font-weight:bold;margin-top:1px;">${esc(r.exercice)} <span style="font-weight:normal;color:${C.gris};">· ${esc(CONTEXTE[r.contexte] ?? r.contexte)}</span></div>
<div>${[r.moment, r.temps].filter((x) => x && String(x).trim()).map((x) => pastille(esc(x))).join("")}</div>`,
    r.commentaire,
  )).join("");
}

function mailPrepaMentale(joueurs: Joueur[], emotions: Emotion[], respirations: Respiration[], debut: string, fin: string): Omit<Mail, "to"> {
  const cartes: string[] = [];
  const rien: Joueur[] = [];
  for (const j of joueurs) {
    const e = emotions.filter((x) => x.joueur_id === j.id);
    const r = respirations.filter((x) => x.joueur_id === j.id);
    if (e.length === 0 && r.length === 0) { rien.push(j); continue; }
    cartes.push(carte(nomComplet(j), rubrique("Émotions") + sectionEmotions(e) + rubrique("Respiration") + sectionRespiration(r)));
  }
  const periode = `${addDays(debut, 6) === fin ? "Semaine du" : "Du"} ${jourFr(debut, false)} au ${jourFr(fin, false)}`;
  return {
    subject: `Bilan préparation mentale — ${NOM_POLE.masculin} — ${periode.toLowerCase()}`,
    html: page(`Préparation mentale — ${NOM_POLE.masculin}`, periode, "Scans émotionnels (intensité sur 5) et exercices de respiration.", cartes.join("") + blocRien(rien, "sa prépa mentale", quandPeriode(debut, fin))),
  };
}

// ─── Envoi (compte Gmail, mot de passe d'application) ────────────────────────
async function envoyer(mail: Mail): Promise<{ ok: boolean; erreur?: string }> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
  if (!user || !pass) return { ok: false, erreur: "GMAIL_USER / GMAIL_APP_PASSWORD manquants" };
  try {
    const transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    await transport.sendMail({
      from: { name: process.env.MAIL_NOM ?? "Pôles France", address: user },
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, erreur: e instanceof Error ? e.message : String(e) };
  }
}

const listeAdresses = (s?: string | null) =>
  (s ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter((x) => x.includes("@"));

export async function GET(req: NextRequest) {
  const apercu = req.nextUrl.searchParams.has("apercu");
  const voir = req.nextUrl.searchParams.get("voir"); // "masculin" | "feminin" | "mentale" → renvoie le HTML
  // ?test=adresse : envoie les 3 mails uniquement à cette adresse (pour vérifier l'envoi)
  const test = listeAdresses(req.nextUrl.searchParams.get("test"))[0];
  const secret = process.env.CRON_SECRET;
  const parEntete = !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
  // ?secret=… accepté pour regarder (aperçu / voir) ou un envoi de test à une seule adresse, jamais pour l'envoi réel
  const parUrl = !!secret && (apercu || !!voir || !!test) && req.nextUrl.searchParams.get("secret") === secret;
  if (!parEntete && !parUrl) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const aujourdhui = todayParis();
  // ?jours=N : période plus longue, uniquement pour regarder (aperçu / voir)
  const joursDemandes = Number(req.nextUrl.searchParams.get("jours"));
  const jours = (apercu || voir || test) && joursDemandes > 0 && joursDemandes <= 90 ? Math.floor(joursDemandes) : 7;
  const debut = addDays(aujourdhui, -jours);
  const fin = addDays(aujourdhui, -1);

  const [joueursR, staffR, formesR, activitesR, emotionsR, respirationsR] = await Promise.all([
    sb.from("joueuses").select("id, prenom, nom, categorie").order("prenom"),
    sb.from("staff").select("prenom, nom, email, masculin, feminin, bilan_hebdo, bilan_mental").or("bilan_hebdo.eq.true,bilan_mental.eq.true"),
    sb.from("suivi_forme").select("joueuse_id, date, fatigue, sommeil, douleur, stress, humeur, commentaire").gte("date", debut).lte("date", fin).order("date"),
    sb.from("activites").select("joueuse_id, date, sport, duree, difficulte, plaisir, commentaire").gte("date", debut).lte("date", fin).order("date"),
    sb.from("suivi_emotions").select("joueur_id, date, emotion_nom, intensite, declencheur, ressources").gte("date", debut).lte("date", fin).order("date"),
    sb.from("suivi_respiration").select("joueur_id, date, contexte, exercice, commentaire, moment, temps").gte("date", debut).lte("date", fin).order("date"),
  ]);
  const erreurLecture = [joueursR, staffR, formesR, activitesR, emotionsR, respirationsR].find((r) => r.error)?.error;
  if (erreurLecture) return NextResponse.json({ ok: false, erreur: erreurLecture.message }, { status: 500 });

  const joueurs = (joueursR.data ?? []) as Joueur[];
  const staff = (staffR.data ?? []) as { email?: string | null; masculin?: boolean; feminin?: boolean; bilan_hebdo?: boolean; bilan_mental?: boolean }[];

  const mails: (Mail & { cle: string })[] = [];
  for (const pole of ["masculin", "feminin"] as Pole[]) {
    const to = [...new Set(staff.filter((s) => s.bilan_hebdo && s[pole]).flatMap((s) => listeAdresses(s.email)))];
    const duPole = joueurs.filter((j) => j.categorie === CATEGORIE[pole]);
    mails.push({ cle: pole, to, ...mailFormeSportif(pole, duPole, (formesR.data ?? []) as Forme[], (activitesR.data ?? []) as Activite[], debut, fin) });
  }
  mails.push({
    cle: "mentale",
    to: [...new Set(staff.filter((s) => s.bilan_mental).flatMap((s) => listeAdresses(s.email)))],
    ...mailPrepaMentale(joueurs.filter((j) => j.categorie === CATEGORIE.masculin), (emotionsR.data ?? []) as Emotion[], (respirationsR.data ?? []) as Respiration[], debut, fin),
  });

  if (voir) {
    const m = mails.find((x) => x.cle === voir);
    if (!m) return NextResponse.json({ error: "voir = masculin | feminin | mentale" }, { status: 400 });
    return new NextResponse(m.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const resultats: Record<string, unknown> = {};
  if (test) {
    for (const m of mails) {
      const r = await envoyer({ ...m, to: [test], subject: `[TEST] ${m.subject}` });
      resultats[m.cle] = { envoye: r.ok, to: [test], vraisDestinataires: m.to, ...(r.erreur ? { erreur: r.erreur } : {}) };
    }
    return NextResponse.json({ ok: true, test: true, periode: { debut, fin }, resultats });
  }
  for (const m of mails) {
    if (m.to.length === 0) { resultats[m.cle] = { envoye: false, raison: "aucun destinataire" }; continue; }
    if (apercu) { resultats[m.cle] = { envoye: false, apercu: true, to: m.to, sujet: m.subject }; continue; }
    const r = await envoyer(m);
    resultats[m.cle] = { envoye: r.ok, to: m.to, ...(r.erreur ? { erreur: r.erreur } : {}) };
  }
  return NextResponse.json({ ok: true, periode: { debut, fin }, resultats });
}
