"use client";

// Stats d'un match tagué : équipe, adversaire, joueurs, carte des tirs, export PDF.

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Joueuse } from "@/types";
import Card from "@/components/Card";
import {
  type Action, type Match, type StatsBloc, calculerStats, estTir, fmtLigne, fmtPct, fmtTemps, score,
} from "@/lib/analyse";
import CarteTirs, { COULEURS_PDF } from "./CarteTirs";

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
      const page = printRef.current?.querySelector<HTMLDivElement>("[data-print-page]");
      if (!page) throw new Error("page introuvable");
      const canvas = await html2canvas(page, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false });
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      doc.addImage(canvas.toDataURL("image/jpeg", 0.93), "JPEG", 0, 0, 210, 297);
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
        <div className="max-w-md mx-auto">
          <CarteTirs tirs={tirsFiltres} />
        </div>
        <p className="text-[11px] mt-2 text-center" style={{ color: "var(--text-muted)" }}>
          ● rentré · ✕ raté · pourcentage par zone (hors lancers francs)
        </p>
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
        <PagePDF match={match} ids={idsJoueurs} actions={actions} lignes={lignesEquipe(stats.equipe, stats.adversaire, avecAdv, avecAdv)} stats={stats} nom={nom} sc={sc} avecAdv={avecAdv} />
      </div>
    </div>
  );
}

function PagePDF({
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
  const S: React.CSSProperties = { fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box" };
  const titre: React.CSSProperties = { fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.03em" };
  const lab: React.CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6b7280", margin: "0 0 8px" };
  const td: React.CSSProperties = { padding: "5px 6px", borderTop: "1px solid #e5e7eb", fontSize: 11.5 };
  const tirsNous = actions.filter((a) => estTir(a) && a.equipe === "nous");

  return (
    <div data-print-page style={{ ...S, width: 794, height: 1123, background: "#fff", color: "#111827", padding: "40px 46px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "3px solid #1E3A6E", paddingBottom: 12 }}>
        <div>
          <p style={{ ...lab, margin: 0 }}>Pôle France · Para Basketball Adapté · Analyse vidéo</p>
          <p style={{ ...titre, fontSize: 34, margin: "4px 0 0", lineHeight: 1 }}>{titreMatch(match)}</p>
          <p style={{ fontSize: 12, color: "#4b5563", margin: "4px 0 0" }}>{dateMatch(match)}{match.competition ? ` · ${match.competition}` : ""}</p>
        </div>
        <p style={{ ...titre, fontSize: 52, margin: 0, lineHeight: 1 }}>
          <span style={{ color: "#C49A28" }}>{sc.nous}</span>
          <span style={{ color: "#9ca3af" }}> – </span>
          <span>{avecAdv ? sc.adversaire : "?"}</span>
        </p>
      </div>

      <div style={{ display: "flex", gap: 24 }}>
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
          <p style={{ fontSize: 9.5, color: "#6b7280", margin: "6px 0 0", textAlign: "center" }}>● rentré · ✕ raté · % par zone, hors LF</p>
        </div>
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
        <p style={{ fontSize: 9.5, color: "#6b7280", margin: "6px 0 0" }}>Tirs en réussis/tentés · Reb O / Reb D : rebonds offensifs / défensifs · BG : ballons gagnés · BP : ballons perdus</p>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {ids.slice(0, 4).map((id) => (
          <div key={id} style={{ width: 160 }}>
            <p style={{ ...lab, marginBottom: 4 }}>{nom(id).split(" ")[0]}</p>
            <CarteTirs tirs={tirsNous.filter((a) => a.joueuse_id === id)} couleurs={COULEURS_PDF} />
          </div>
        ))}
      </div>

      {(() => {
        const reperes = actions.filter((a) => a.type === "repere");
        if (!reperes.length) return null;
        const max = 10;
        return (
          <div>
            <p style={lab}>Repères</p>
            {reperes.slice(0, max).map((a) => (
              <p key={a.id} style={{ fontSize: 11, margin: "0 0 3px", display: "flex", gap: 10 }}>
                <span style={{ width: 44, color: "#9A7818", fontVariantNumeric: "tabular-nums" }}>{fmtTemps(a.t - (match.video_debut ?? 0))}</span>
                <span style={{ color: a.titre ? "#111827" : "#9ca3af" }}>{a.titre || "Sans titre"}</span>
              </p>
            ))}
            {reperes.length > max && <p style={{ fontSize: 10, color: "#6b7280", margin: "4px 0 0" }}>… et {reperes.length - max} autres repères dans l&apos;application</p>}
          </div>
        );
      })()}

      <p style={{ marginTop: "auto", fontSize: 9, color: "#9ca3af" }}>
        Stats saisies par le staff à partir de la vidéo. Généré le {new Date().toLocaleDateString("fr-FR")}.
      </p>
    </div>
  );
}
