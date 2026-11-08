"use client";

// Stats d'un match tagué : équipe, adversaire, joueurs, carte des tirs, export PDF.

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Joueuse } from "@/types";
import Card from "@/components/Card";
import {
  type Action, type Match, type StatsBloc, calculerStats, estTir, fmtLigne, fmtPct, fmtTemps, score,
} from "@/lib/analyse";
import CarteTirs, { COULEURS_PDF, SchemaZones, fmtZoneLigne, fmtZonePct, statsZones } from "./CarteTirs";

const labelStyle: React.CSSProperties = {
  fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-sub)",
};

export function titreMatch(m: Match) {
  return m.adversaire ? `France vs ${m.adversaire}` : "Match";
}
export function dateMatch(m: Match, format: "long" | "court" = "long") {
  return new Date(m.date_match + "T12:00:00").toLocaleDateString("fr-FR",
    format === "long" ? { weekday: "long", day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "short" });
}

/** Lignes du tableau équipe : libellé + valeur pour nous / l'adversaire. */
function lignesEquipe(n: StatsBloc, a: StatsBloc, avecAdv: boolean, avecTirsAdv: boolean) {
  const adv = (v: string) => (avecAdv ? v : "–");
  const advTir = (v: string) => (avecTirsAdv ? v : "–");
  const tir = (l: StatsBloc["tirs"]) => (l.tentes ? `${fmtLigne(l)} · ${fmtPct(l)}` : "–");
  return [
    { label: "Points", nous: String(n.points), adv: advTir(String(a.points)) },
    { label: "Tirs en jeu", nous: tir(n.tirs), adv: advTir(tir(a.tirs)) },
    { label: "Tirs à 1 pt", nous: tir(n.tirs1), adv: advTir(tir(a.tirs1)) },
    { label: "Tirs à 2 pts", nous: tir(n.tirs2), adv: advTir(tir(a.tirs2)) },
    { label: "Lancers francs", nous: tir(n.lf), adv: advTir(tir(a.lf)) },
    { label: "Rebonds offensifs", nous: String(n.rebOff), adv: adv(String(a.rebOff)) },
    { label: "Rebonds défensifs", nous: String(n.rebDef), adv: adv(String(a.rebDef)) },
    { label: "Ballons gagnés", nous: String(n.gagnes), adv: "–" },
    { label: "Ballons perdus", nous: String(n.perdus), adv: "–" },
  ];
}

const COLONNES_JOUEURS = ["Pts", "1 pt", "2 pts", "LF", "Reb O", "Reb D", "BG", "BP"];
const valeursJoueur = (s: StatsBloc) => [
  String(s.points), fmtLigne(s.tirs1), fmtLigne(s.tirs2), fmtLigne(s.lf),
  String(s.rebOff), String(s.rebDef), String(s.gagnes), String(s.perdus),
];

export default function RapportMatch({
  match, joueurs, onFermer, onTaguer,
}: {
  match: Match;
  joueurs: Joueuse[];
  onFermer: () => void;
  onTaguer: () => void;
}) {
  const [actions, setActions] = useState<Action[] | null>(null);
  const [erreur, setErreur] = useState(false);
  const [filtre, setFiltre] = useState<string>("equipe");
  const [pdf, setPdf] = useState<"idle" | "en_cours" | "ok" | "erreur">("idle");
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from("analyse_actions").select("*").eq("match_id", match.id).order("t").then(({ data, error }) => {
      if (error) setErreur(true);
      setActions((data ?? []) as Action[]);
    });
  }, [match.id]);

  const nom = (id: string) => {
    const j = joueurs.find((x) => x.id === id);
    return j ? `${j.prenom} ${j.nom}` : "Joueur";
  };
  // Joueurs du match, plus ceux retirés de l'effectif après avoir été tagués
  const idsJoueurs = useMemo(() => {
    const ids = [...match.effectif];
    for (const a of actions ?? []) if (a.joueuse_id && !ids.includes(a.joueuse_id)) ids.push(a.joueuse_id);
    return ids;
  }, [actions, match.effectif]);
  const stats = useMemo(() => (actions ? calculerStats(actions, idsJoueurs) : null), [actions, idsJoueurs]);
  const sc = actions ? score(actions) : { nous: 0, adversaire: 0 };
  const avecAdv = match.mode_adversaire !== "aucun";
  const avecTirsAdvPos = match.mode_adversaire === "position";

  const tirsFiltres = useMemo(() => {
    if (!actions) return [];
    const tirs = actions.filter(estTir);
    if (filtre === "equipe") return tirs.filter((a) => a.equipe === "nous");
    if (filtre === "adversaire") return tirs.filter((a) => a.equipe === "adversaire");
    return tirs.filter((a) => a.joueuse_id === filtre);
  }, [actions, filtre]);

  const exporter = async () => {
    setPdf("en_cours");
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas")]);
      const pages = Array.from(printRef.current?.querySelectorAll<HTMLDivElement>("[data-print-page]") ?? []);
      if (!pages.length) throw new Error("page introuvable");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      // html2canvas mesure la hauteur des polices avec une petite image cachée
      // ajoutée au <body>. Tailwind affiche toutes les images en bloc : l'image
      // tombe sous la ligne et tout le texte du PDF est dessiné trop bas, d'autant
      // plus que le texte est gros. On remet cette image en ligne le temps de l'export.
      const correctif = document.createElement("style");
      correctif.textContent = 'body > div[style*="visibility: hidden"] > img { display: inline !important; }';
      document.head.appendChild(correctif);
      try {
        for (let i = 0; i < pages.length; i++) {
          const canvas = await html2canvas(pages[i], { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false });
          if (i > 0) doc.addPage();
          doc.addImage(canvas.toDataURL("image/jpeg", 0.93), "JPEG", 0, 0, 210, 297);
        }
      } finally {
        correctif.remove();
      }
      const adv = (match.adversaire || "match").toLowerCase().replace(/[^a-z0-9]+/g, "-");
      doc.save(`stats_${match.date_match}_${adv}.pdf`);
      setPdf("ok");
      setTimeout(() => setPdf("idle"), 2500);
    } catch (err) {
      console.error("[Analyse] PDF", err);
      setPdf("erreur");
    }
  };

  if (!actions || !stats) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  const lignes = lignesEquipe(stats.equipe, stats.adversaire, avecAdv, avecAdv);
  const enAttente = stats.equipe.enAttente + stats.adversaire.enAttente;

  return (
    <div className="space-y-5 animate-fade-in-up">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onFermer} className="hover-text-main text-sm font-medium mr-auto" style={{ color: "var(--text-sub)" }}>← Matchs</button>
        <button onClick={onTaguer} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ border: "1px solid var(--border)", color: "var(--text-sub)" }}>
          Reprendre le tagging
        </button>
        <button
          onClick={exporter}
          disabled={pdf === "en_cours"}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80 active:scale-95 disabled:opacity-50"
          style={{ background: "rgba(196,154,40,0.12)", border: "1px solid rgba(196,154,40,0.3)", color: "#C49A28" }}
        >
          📄 {pdf === "en_cours" ? "Création…" : pdf === "ok" ? "PDF téléchargé" : pdf === "erreur" ? "Erreur, réessayer" : "Export PDF"}
        </button>
      </div>

      {erreur && (
        <p className="text-sm rounded-lg px-4 py-3" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5" }}>
          Les actions n&apos;ont pas pu être chargées. Vérifie la connexion.
        </p>
      )}

      <Card>
        <p style={labelStyle}>{dateMatch(match)}{match.competition ? ` · ${match.competition}` : ""}</p>
        <div className="flex flex-wrap items-end justify-between gap-3 mt-1">
          <h2 className="font-display text-3xl leading-none court-line" style={{ color: "var(--text-main)" }}>{titreMatch(match)}</h2>
          <p className="font-display text-5xl leading-none" style={{ fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: "var(--accent)" }}>{sc.nous}</span>
            <span style={{ color: "var(--text-muted)" }}> – </span>
            <span style={{ color: "var(--text-main)" }}>{avecAdv ? sc.adversaire : "?"}</span>
          </p>
        </div>
        {enAttente > 0 && (
          <p className="text-xs mt-3" style={{ color: "#fcd34d" }}>
            {enAttente} tir{enAttente > 1 ? "s" : ""} sans résultat, non compté{enAttente > 1 ? "s" : ""}. Reprends le tagging pour les trancher.
          </p>
        )}
        {!avecAdv && <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>Tirs adverses non tagués : score adverse inconnu.</p>}
      </Card>

      <Card>
        <p style={labelStyle} className="mb-3">Équipe</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr style={{ color: "var(--text-sub)" }}>
                <th className="text-left font-medium py-1.5" />
                <th className="text-right font-medium py-1.5 px-2" style={{ color: "var(--accent)" }}>France</th>
                <th className="text-right font-medium py-1.5 px-2">{match.adversaire || "Adversaire"}</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.label} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="py-2" style={{ color: "var(--text-sub)" }}>{l.label}</td>
                  <td className="py-2 px-2 text-right font-medium" style={{ color: "var(--text-main)" }}>{l.nous}</td>
                  <td className="py-2 px-2 text-right" style={{ color: "var(--text-muted)" }}>{l.adv}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <p style={labelStyle} className="mb-3">Joueurs</p>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[520px]" style={{ fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr style={{ color: "var(--text-sub)" }}>
                <th className="text-left font-medium py-1.5 px-1">Joueur</th>
                {COLONNES_JOUEURS.map((c) => <th key={c} className="text-right font-medium py-1.5 px-1.5">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {idsJoueurs.map((id) => (
                <tr key={id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="py-2 px-1 font-medium" style={{ color: "var(--text-main)" }}>{nom(id)}</td>
                  {valeursJoueur(stats.joueurs[id]).map((v, i) => (
                    <td key={i} className="py-2 px-1.5 text-right" style={{ color: i === 0 ? "var(--accent)" : "var(--text-main)" }}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>Tirs en réussis/tentés · BG : ballons gagnés · BP : ballons perdus</p>
      </Card>

      <Card>
        <p style={labelStyle} className="mb-3">Carte des tirs</p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {[
            { id: "equipe", label: "Équipe" },
            ...idsJoueurs.map((id) => ({ id, label: joueurs.find((j) => j.id === id)?.prenom ?? "Joueur" })),
            ...(avecTirsAdvPos ? [{ id: "adversaire", label: match.adversaire || "Adversaire" }] : []),
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFiltre(f.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={filtre === f.id
                ? { background: "var(--primary)", color: "white" }
                : { background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex-1 min-w-[260px] max-w-md">
            <CarteTirs tirs={tirsFiltres} />
            <p className="text-[11px] mt-2 text-center" style={{ color: "var(--text-muted)" }}>● rentré · ✕ raté</p>
          </div>
          <table className="text-sm w-full sm:w-56" style={{ fontVariantNumeric: "tabular-nums" }}>
            <caption className="text-left pb-1.5" style={labelStyle}>Réussite par zone</caption>
            <tbody>
              {statsZones(tirsFiltres).map((z) => (
                <tr key={z.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="py-1.5" style={{ color: "var(--text-sub)" }}>{z.label}</td>
                  <td className="py-1.5 px-2 text-right" style={{ color: "var(--text-main)" }}>{fmtZoneLigne(z.l)}</td>
                  <td className="py-1.5 text-right w-12" style={{ color: z.l.tentes ? "var(--accent)" : "var(--text-muted)" }}>{fmtZonePct(z.l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {actions.some((a) => a.type === "repere") && (
        <Card>
          <p style={labelStyle} className="mb-3">Repères</p>
          <ol className="space-y-1">
            {actions.filter((a) => a.type === "repere").map((a) => (
              <li key={a.id} className="flex gap-3 py-1.5 text-sm" style={{ borderTop: "1px solid var(--border)" }}>
                <span className="w-14 shrink-0" style={{ color: "var(--accent)", fontVariantNumeric: "tabular-nums" }}>{fmtTemps(a.t - (match.video_debut ?? 0))}</span>
                <span className="min-w-0" style={{ color: a.titre ? "var(--text-main)" : "var(--text-muted)" }}>{a.titre || "Sans titre"}</span>
              </li>
            ))}
          </ol>
          <p className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>
            Temps depuis le début du match. Pour revoir un moment, reprends le tagging : les repères y sont cliquables.
          </p>
        </Card>
      )}

      {/* Page imprimée pour le PDF (hors écran) */}
      <div ref={printRef} style={{ position: "fixed", left: "-9999px", top: 0, pointerEvents: "none", zIndex: -1 }} aria-hidden="true">
        <PageCoach match={match} ids={idsJoueurs} actions={actions} lignes={lignesEquipe(stats.equipe, stats.adversaire, avecAdv, avecAdv)} stats={stats} nom={nom} sc={sc} avecAdv={avecAdv} />
        {idsJoueurs.map((id) => (
          <PageJoueur
            key={id}
            match={match}
            prenom={joueurs.find((j) => j.id === id)?.prenom ?? "Joueur"}
            nomFamille={joueurs.find((j) => j.id === id)?.nom ?? ""}
            s={stats.joueurs[id]}
            tirs={actions.filter((a) => estTir(a) && a.equipe === "nous" && a.joueuse_id === id)}
            sc={sc}
            avecAdv={avecAdv}
          />
        ))}
      </div>
    </div>
  );
}

// ─── PDF ─────────────────────────────────────────────────────────────────────
// Page 1 : vue d'ensemble pour le coach. Pages suivantes : une par joueur,
// écrite pour être lue facilement (gros texte, mots simples, pastilles à compter).

const PDF_FONT: React.CSSProperties = { fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box" };
const PDF_TITRE: React.CSSProperties = { fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.03em", fontWeight: 400 };
const PDF_PAGE: React.CSSProperties = { ...PDF_FONT, width: 794, height: 1123, background: "#fff", color: "#111827", display: "flex", flexDirection: "column" };

function PageCoach({
  match, ids, actions, lignes, stats, nom, sc, avecAdv,
}: {
  match: Match;
  ids: string[];
  actions: Action[];
  lignes: ReturnType<typeof lignesEquipe>;
  stats: ReturnType<typeof calculerStats>;
  nom: (id: string) => string;
  sc: { nous: number; adversaire: number };
  avecAdv: boolean;
}) {
  const lab: React.CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6b7280", margin: "0 0 6px" };
  const td: React.CSSProperties = { padding: "5px 6px", borderTop: "1px solid #e5e7eb", fontSize: 11.5 };
  const tirsNous = actions.filter((a) => estTir(a) && a.equipe === "nous");
  const zones = statsZones(tirsNous);
  // Tirs adverses placés sur le terrain (match suivi « comme pour nous »)
  const tirsAdvPos = actions.filter((a) => a.type === "tir" && a.equipe === "adversaire" && a.x !== null && a.y !== null);

  return (
    <div data-print-page style={{ ...PDF_PAGE, padding: "36px 46px 28px", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "3px solid #1E3A6E", paddingBottom: 10 }}>
        <div>
          <p style={{ ...PDF_TITRE, fontSize: 34, margin: 0, lineHeight: 1 }}>{titreMatch(match)}</p>
          <p style={{ fontSize: 12, color: "#4b5563", margin: "3px 0 0" }}>{dateMatch(match)}{match.competition ? ` · ${match.competition}` : ""}</p>
        </div>
        <p style={{ ...PDF_TITRE, fontSize: 52, margin: 0, lineHeight: 1 }}>
          <span style={{ color: "#C49A28" }}>{sc.nous}</span>
          <span style={{ color: "#9ca3af" }}> – </span>
          <span>{avecAdv ? sc.adversaire : "?"}</span>
        </p>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <p style={lab}>Équipe</p>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...td, borderTop: "none", textAlign: "left" }} />
                <th style={{ ...td, borderTop: "none", textAlign: "right", color: "#9A7818" }}>France</th>
                <th style={{ ...td, borderTop: "none", textAlign: "right", color: "#6b7280" }}>{match.adversaire || "Adversaire"}</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.label}>
                  <td style={{ ...td, color: "#4b5563" }}>{l.label}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{l.nous}</td>
                  <td style={{ ...td, textAlign: "right", color: "#6b7280" }}>{l.adv}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ width: 300 }}>
          <p style={lab}>Carte des tirs · France</p>
          <CarteTirs tirs={tirsNous} couleurs={COULEURS_PDF} />
          <p style={{ fontSize: 9.5, color: "#6b7280", margin: "5px 0 0", textAlign: "center" }}>● rentré · ✕ raté</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ width: 340 }}>
          <p style={lab}>Réussite par zone · France</p>
          <SchemaZones tirs={tirsNous} />
          <p style={{ fontSize: 9.5, color: "#6b7280", margin: "5px 0 0" }}>Réussis/tentés par zone, hors lancers francs. Plus la zone est foncée, plus elle est réussie.</p>
        </div>
        {tirsAdvPos.length > 0 ? (
          <div style={{ flex: 1 }}>
            <p style={lab}>Tirs de {match.adversaire || "l'adversaire"}</p>
            <CarteTirs tirs={tirsAdvPos} couleurs={COULEURS_PDF} />
            <p style={{ fontSize: 9.5, color: "#6b7280", margin: "5px 0 0", textAlign: "center" }}>● rentré · ✕ raté</p>
          </div>
        ) : (
          <table style={{ flex: 1, borderCollapse: "collapse", marginTop: 18 }}>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id}>
                  <td style={{ ...td, color: "#4b5563" }}>{z.label}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{fmtZoneLigne(z.l)}</td>
                  <td style={{ ...td, textAlign: "right", color: z.l.tentes ? "#9A7818" : "#9ca3af", width: 52 }}>{fmtZonePct(z.l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <p style={lab}>Joueurs</p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...td, borderTop: "none", textAlign: "left", color: "#6b7280" }}>Joueur</th>
              {COLONNES_JOUEURS.map((c) => <th key={c} style={{ ...td, borderTop: "none", textAlign: "right", color: "#6b7280" }}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => (
              <tr key={id}>
                <td style={{ ...td, fontWeight: 600 }}>{nom(id)}</td>
                {valeursJoueur(stats.joueurs[id]).map((v, i) => <td key={i} style={{ ...td, textAlign: "right", color: i === 0 ? "#9A7818" : "#111827", fontWeight: i === 0 ? 700 : 400 }}>{v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 9.5, color: "#6b7280", margin: "5px 0 0" }}>Tirs en réussis/tentés · Reb O / Reb D : rebonds offensifs / défensifs · BG : ballons gagnés · BP : ballons perdus · Détail de chaque joueur dans les pages suivantes</p>
      </div>

    </div>
  );
}

const VERT = "#15803d";
const ROUGE = "#dc2626";

/** Une pastille par tir : verte et pleine si marqué, cercle rouge vide si raté. */
function Pastilles({ l }: { l: { reussis: number; tentes: number } }) {
  if (l.tentes > 24) return null; // trop nombreux pour être comptés d'un coup d'œil : le nombre suffit
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
      {Array.from({ length: l.tentes }, (_, i) => (
        <span
          key={i}
          style={i < l.reussis
            ? { width: 18, height: 18, borderRadius: 9, background: VERT }
            : { width: 18, height: 18, borderRadius: 9, border: `3px solid ${ROUGE}`, boxSizing: "border-box" }}
        />
      ))}
    </div>
  );
}

function PageJoueur({
  match, prenom, nomFamille, s, tirs, sc, avecAdv,
}: {
  match: Match;
  prenom: string;
  nomFamille: string;
  s: StatsBloc;
  tirs: Action[];
  sc: { nous: number; adversaire: number };
  avecAdv: boolean;
}) {
  // Chiffres en DM Sans gras (pas en Bebas Neue) : plus lisibles, et ils restent
  // alignés avec le texte une fois la page transformée en image pour le PDF.
  const bloc: React.CSSProperties = { border: "2px solid #e5e7eb", borderRadius: 14, padding: "16px 20px" };
  const titreBloc: React.CSSProperties = { fontSize: 19, fontWeight: 700, lineHeight: "24px", margin: 0 };
  const chiffre = (couleur: string, taille = 40): React.CSSProperties => ({ fontSize: taille, fontWeight: 700, color: couleur, fontVariantNumeric: "tabular-nums" });
  const date = new Date(match.date_match + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  const tir = (label: string, l: { reussis: number; tentes: number }) => (
    <div style={bloc}>
      <p style={titreBloc}>{label}</p>
      {l.tentes ? (
        <>
          {/* Une seule ligne de texte, même hauteur de ligne pour tout : alignement sur la ligne de base */}
          <p style={{ margin: "8px 0 0", fontSize: 20, lineHeight: "48px", height: 48, whiteSpace: "nowrap" }}>
            <span style={chiffre(VERT)}>{l.reussis}</span>
            <span style={{ margin: "0 10px" }}>marqué{l.reussis > 1 ? "s" : ""} sur</span>
            <span style={chiffre("#111827")}>{l.tentes}</span>
          </p>
          <Pastilles l={l} />
        </>
      ) : (
        <p style={{ margin: "8px 0 0", fontSize: 19, lineHeight: "48px", color: "#6b7280" }}>Pas de tir</p>
      )}
    </div>
  );

  const compte = (label: string, n: number, couleur: string, detail?: string) => (
    <div style={{ ...bloc, display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", columnGap: 12 }}>
      <div>
        <p style={titreBloc}>{label}</p>
        {detail && <p style={{ margin: "6px 0 0", fontSize: 15, lineHeight: "20px", color: "#4b5563" }}>{detail}</p>}
      </div>
      <span style={{ ...chiffre(couleur, 50), display: "block", lineHeight: "56px" }}>{n}</span>
    </div>
  );

  return (
    <div data-print-page style={{ ...PDF_PAGE, padding: "38px 50px 30px", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, borderBottom: "4px solid #1E3A6E", paddingBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ ...PDF_TITRE, fontSize: 58, margin: 0, lineHeight: 1.05 }}>{prenom} <span style={{ color: "#1E3A6E" }}>{nomFamille}</span></p>
          <p style={{ margin: "8px 0 0", fontSize: 18 }}>
            {match.adversaire ? `France contre ${match.adversaire}` : "Match de la France"} · {date}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 18 }}>
            Score : <strong>France {sc.nous}</strong>{avecAdv ? <> · {match.adversaire || "Adversaire"} {sc.adversaire}</> : null}
          </p>
        </div>
      </div>

      <div>
        <p style={{ ...titreBloc, fontSize: 22, margin: "0 0 8px" }}>Mes tirs sur le terrain</p>
        <div style={{ display: "flex", gap: 22, alignItems: "center" }}>
          <div style={{ width: 470 }}>
            <CarteTirs tirs={tirs} couleurs={{ ...COULEURS_PDF, reussi: VERT, rate: ROUGE }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, fontSize: 20 }}>
            <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 26, height: 26, borderRadius: 13, background: VERT, display: "inline-block" }} /> Marqué
            </p>
            <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 12 }}>
              <svg width="26" height="26" viewBox="0 0 26 26"><path d="M5 5 L21 21 M21 5 L5 21" stroke={ROUGE} strokeWidth="4" strokeLinecap="round" /></svg> Raté
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {tir("Tirs à 1 point", s.tirs1)}
        {tir("Tirs à 2 points", s.tirs2)}
        {tir("Lancers francs", s.lf)}
        {compte("Rebonds", s.rebOff + s.rebDef, "#1E3A6E", s.rebOff + s.rebDef ? `${s.rebDef} en défense · ${s.rebOff} en attaque` : undefined)}
        {compte("Ballons gagnés", s.gagnes, VERT)}
        {compte("Ballons perdus", s.perdus, ROUGE)}
      </div>

      <p style={{ marginTop: "auto", fontSize: 11, color: "#9ca3af", display: "flex", justifyContent: "space-between" }}>
        <span>Pôle France · Para Basketball Adapté</span>
        <span>{titreMatch(match)} · {date}</span>
      </p>
    </div>
  );
}
