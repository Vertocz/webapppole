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

const C = { texte: "#1f2937", gris: "#6b7280", bord: "#e5e7eb", fond: "#f9fafb", rouge: "#b91c1c", orange: "#c2410c", vert: "#15803d" };

function page(titre: string, sousTitre: string, contenu: string): string {
  return `<!DOCTYPE html><html lang="fr"><body style="margin:0;padding:0;background:#f3f4f6;">
<div style="max-width:680px;margin:0 auto;padding:20px 12px;font-family:Arial,Helvetica,sans-serif;color:${C.texte};font-size:14px;line-height:1.45;">
<h1 style="font-size:20px;margin:0 0 4px;">${esc(titre)}</h1>
<p style="margin:0 0 18px;color:${C.gris};">${esc(sousTitre)}</p>
${contenu}
</div></body></html>`;
}
const carte = (titre: string, contenu: string) =>
  `<div style="background:#fff;border:1px solid ${C.bord};border-radius:10px;padding:14px 16px;margin:0 0 12px;">
<h2 style="font-size:16px;margin:0 0 10px;">${esc(titre)}</h2>${contenu}</div>`;
const sousTitre = (t: string) => `<p style="margin:10px 0 6px;font-weight:bold;">${t}</p>`;
const vide = (t: string) => `<p style="margin:4px 0;color:${C.gris};font-style:italic;">${esc(t)}</p>`;
const blocRien = (js: Joueur[], quoi: string, quand: string) =>
  js.length === 0
    ? `<p style="margin:16px 0 0;color:${C.vert};">✅ Tout le monde a rempli ${esc(quoi)} ${quand}.</p>`
    : `<div style="margin:16px 0 0;padding:12px 16px;background:${C.fond};border:1px dashed ${C.bord};border-radius:10px;">
<b>Rien de saisi ${quand}</b> (${js.length}) : ${esc(prenomsListe(js))}.</div>`;
const quandPeriode = (debut: string, fin: string) => (addDays(debut, 6) === fin ? "cette semaine" : "sur la période");

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
  return mauvais >= 5 ? C.rouge : mauvais >= 4 ? C.orange : C.texte;
}

function sectionForme(saisies: Forme[]): string {
  if (saisies.length === 0) return vide("Pas de suivi de forme rempli.");
  const th = (t: string) => `<th style="padding:4px;border-bottom:1px solid ${C.bord};font-weight:normal;color:${C.gris};font-size:12px;text-align:center;">${t}</th>`;
  const entete = `<tr>${th("")}${INDICATEURS.map((i) => th(i.label)).join("")}</tr>`;
  const lignes = saisies.map((s) => {
    const notes = INDICATEURS.map(({ cle, sensDefavorable }) => {
      const v = Number(s[cle]);
      return `<td style="padding:5px 4px;text-align:center;font-weight:bold;color:${couleurNote(v, sensDefavorable)};">${v}/5</td>`;
    }).join("");
    const com = s.commentaire?.trim()
      ? `<tr><td></td><td colspan="5" style="padding:0 4px 6px;color:${C.gris};">💬 ${esc(s.commentaire)}</td></tr>`
      : "";
    return `<tr style="border-top:1px solid ${C.bord};"><td style="padding:5px 4px;white-space:nowrap;color:${C.gris};">${esc(jourFr(s.date))}</td>${notes}</tr>${com}`;
  }).join("");
  return `<table style="border-collapse:collapse;width:100%;font-size:13px;">${entete}${lignes}</table>`;
}

function sectionSportif(seances: Activite[]): string {
  if (seances.length === 0) return vide("Pas de séance saisie.");
  const lignes = seances.map((a) => `<div style="padding:7px 0;border-top:1px solid ${C.bord};">
<div><span style="color:${C.gris};">${esc(jourFr(a.date))}</span> · <b>${esc(a.sport)}</b></div>
<div style="margin-top:2px;">⏱ ${esc(a.duree)} &nbsp; 💪 Difficulté ${a.difficulte}/10 &nbsp; 😄 Plaisir ${a.plaisir}/10</div>
${a.commentaire?.trim() ? `<div style="margin-top:2px;color:${C.gris};">💬 ${esc(a.commentaire)}</div>` : ""}</div>`).join("");
  return `<p style="margin:0 0 4px;color:${C.gris};font-size:12px;">${seances.length} séance${seances.length > 1 ? "s" : ""}</p>${lignes}`;
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
  const periode = `${addDays(debut, 6) === fin ? "Semaine du" : "Du"} ${jourFr(debut, false)} au ${jourFr(fin, false)}`;
  return {
    subject: `Bilan forme & sportif — ${NOM_POLE[pole]} — ${periode.toLowerCase()}`,
    html: page(`Forme & suivi sportif — ${NOM_POLE[pole]}`, periode, cartes.join("") + blocRien(rien, "son suivi", quandPeriode(debut, fin))),
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
  const cartes: string[] = [];
  const rien: Joueur[] = [];
  for (const j of joueurs) {
    const e = emotions.filter((x) => x.joueur_id === j.id);
    const r = respirations.filter((x) => x.joueur_id === j.id);
    if (e.length === 0 && r.length === 0) { rien.push(j); continue; }
    cartes.push(carte(nomComplet(j), sousTitre("Émotions") + sectionEmotions(e) + sousTitre("Respiration") + sectionRespiration(r)));
  }
  const periode = `${addDays(debut, 6) === fin ? "Semaine du" : "Du"} ${jourFr(debut, false)} au ${jourFr(fin, false)}`;
  return {
    subject: `Bilan préparation mentale — ${NOM_POLE.masculin} — ${periode.toLowerCase()}`,
    html: page(`Préparation mentale — ${NOM_POLE.masculin}`, periode, cartes.join("") + blocRien(rien, "sa prépa mentale", quandPeriode(debut, fin))),
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
  const secret = process.env.CRON_SECRET;
  const parEntete = !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
  // ?secret=… accepté uniquement pour regarder (aperçu / voir), jamais pour envoyer
  const parUrl = !!secret && (apercu || !!voir) && req.nextUrl.searchParams.get("secret") === secret;
  if (!parEntete && !parUrl) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const aujourdhui = todayParis();
  // ?jours=N : période plus longue, uniquement pour regarder (aperçu / voir)
  const joursDemandes = Number(req.nextUrl.searchParams.get("jours"));
  const jours = (apercu || voir) && joursDemandes > 0 && joursDemandes <= 90 ? Math.floor(joursDemandes) : 7;
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
  for (const m of mails) {
    if (m.to.length === 0) { resultats[m.cle] = { envoye: false, raison: "aucun destinataire" }; continue; }
    if (apercu) { resultats[m.cle] = { envoye: false, apercu: true, to: m.to, sujet: m.subject }; continue; }
    const r = await envoyer(m);
    resultats[m.cle] = { envoye: r.ok, to: m.to, ...(r.erreur ? { erreur: r.erreur } : {}) };
  }
  return NextResponse.json({ ok: true, periode: { debut, fin }, resultats });
}
