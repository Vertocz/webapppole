"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────────────
interface TrajetRaw {
  gare_depart: string;
  gare_arrivee: string;
  heure_depart: string;
  heure_arrivee: string;
  billet_id: number;
}

interface Entree {
  heure: string;
  nomComplet: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtHeure(t: string) {
  const [h, m] = t.split(":");
  return `${h}h${m}`;
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long",
  });
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Gares de stage prioritaires pour l'auto-détection
const GARES_STAGE = ["poitiers", "nantes"];

function detecterGareStage(arrivees: Record<string, Entree[]>): string {
  if (Object.keys(arrivees).length === 0) return "";

  // Chercher Poitiers puis Nantes (dans l'ordre de priorité)
  for (const stage of GARES_STAGE) {
    const match = Object.keys(arrivees).find(g =>
      g.toLowerCase().includes(stage)
    );
    if (match) return match;
  }

  // Sinon : gare avec le plus d'arrivées
  return Object.entries(arrivees)
    .sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? "";
}

// ── Composant ──────────────────────────────────────────────────────────────────
export default function GaresLogistique() {
  const [dates, setDates]             = useState<string[]>([]);
  const [dateIdx, setDateIdx]         = useState<number>(0);
  const [arrivees, setArrivees]       = useState<Record<string, Entree[]>>({});
  const [departs, setDeparts]         = useState<Record<string, Entree[]>>({});
  const [garesDispos, setGaresDispos] = useState<string[]>([]);
  const [selectedGare, setSelectedGare] = useState<string>("");
  const [loading, setLoading]         = useState(true);
  const [loadingData, setLoadingData] = useState(false);

  // ── Étape 1 : dates distinctes ─────────────────────────────────────────────
  useEffect(() => {
    supabase
      .from("trajets")
      .select("date_depart")
      .order("date_depart", { ascending: true })
      .then(({ data }) => {
        if (!data) { setLoading(false); return; }
        const unique = [...new Set(data.map((t) => t.date_depart as string))].sort();
        setDates(unique);
        const today = new Date().toISOString().split("T")[0];
        const idx = unique.indexOf(today);
        setDateIdx(idx >= 0 ? idx : 0);
        setLoading(false);
      });
  }, []);

  // ── Étapes 2-4 : trajets → billets → noms ─────────────────────────────────
  const loadDate = useCallback(async (date: string) => {
    setLoadingData(true);
    setArrivees({});
    setDeparts({});
    setGaresDispos([]);

    const { data: trajets } = await supabase
      .from("trajets")
      .select("gare_depart, gare_arrivee, heure_depart, heure_arrivee, billet_id")
      .eq("date_depart", date);

    if (!trajets || trajets.length === 0) { setLoadingData(false); return; }

    const billetIds = [...new Set((trajets as TrajetRaw[]).map((t) => t.billet_id))];

    const { data: billets } = await supabase
      .from("billets")
      .select("id, joueuse_id")
      .in("id", billetIds);

    if (!billets || billets.length === 0) { setLoadingData(false); return; }

    const billetMap: Record<number, string> = {};
    for (const b of billets) billetMap[b.id] = b.joueuse_id;

    const personIds = [...new Set(Object.values(billetMap))];

    const [{ data: joueuses }, { data: staffList }] = await Promise.all([
      supabase.from("joueuses").select("id, prenom, nom").in("id", personIds),
      supabase.from("staff").select("id, prenom, nom").in("id", personIds),
    ]);

    const nameMap: Record<string, string> = {};
    for (const j of joueuses  ?? []) nameMap[j.id] = `${j.prenom} ${j.nom.toUpperCase()}`;
    for (const s of staffList  ?? []) nameMap[s.id] = `${s.prenom} ${s.nom.toUpperCase()}`;

    const arr: Record<string, Entree[]> = {};
    const dep: Record<string, Entree[]> = {};

    for (const t of trajets as TrajetRaw[]) {
      const joueuse_id = billetMap[t.billet_id];
      if (!joueuse_id) continue;
      const nomComplet = nameMap[joueuse_id] ?? "Inconnu";

      const gA = t.gare_arrivee?.trim();
      if (gA) {
        if (!arr[gA]) arr[gA] = [];
        arr[gA].push({ heure: t.heure_arrivee, nomComplet });
      }

      const gD = t.gare_depart?.trim();
      if (gD) {
        if (!dep[gD]) dep[gD] = [];
        dep[gD].push({ heure: t.heure_depart, nomComplet });
      }
    }

    for (const g of Object.keys(arr)) arr[g].sort((a, b) => a.heure.localeCompare(b.heure));
    for (const g of Object.keys(dep)) dep[g].sort((a, b) => a.heure.localeCompare(b.heure));

    // Gares disponibles = union des gares d'arrivée et de départ
    const toutesGares = [...new Set([...Object.keys(arr), ...Object.keys(dep)])].sort();

    setArrivees(arr);
    setDeparts(dep);
    setGaresDispos(toutesGares);

    // Auto-sélection : gare de stage détectée en priorité
    setSelectedGare(prev => {
      // Si la gare déjà sélectionnée existe encore pour ce jour, on la garde
      if (prev && toutesGares.includes(prev)) return prev;
      return detecterGareStage(arr) || toutesGares[0] || "";
    });

    setLoadingData(false);
  }, []);

  useEffect(() => {
    if (dates.length > 0 && dates[dateIdx]) loadDate(dates[dateIdx]);
  }, [dates, dateIdx, loadDate]);

  // ── Rendu ──────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
    </div>
  );

  if (dates.length === 0) return (
    <div className="text-center py-16" style={{ color: "var(--text-muted)" }}>
      <p className="text-4xl mb-3">🚉</p>
      <p className="text-sm">Aucun trajet enregistré.</p>
    </div>
  );

  const currentDate     = dates[dateIdx];
  const arriveesFiltrees = selectedGare ? (arrivees[selectedGare] ?? []) : [];
  const departsFiltres   = selectedGare ? (departs[selectedGare]  ?? []) : [];
  const aucunTrajet      = arriveesFiltrees.length === 0 && departsFiltres.length === 0;

  return (
    <div className="space-y-4">

      {/* ── Navigation date ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setDateIdx(i => Math.max(0, i - 1))}
          disabled={dateIdx === 0}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-95 disabled:opacity-25"
          style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)", fontSize: "1.25rem" }}>
          ‹
        </button>

        <div className="flex-1 text-center">
          <p className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
            {capitalize(fmtDate(currentDate))}
          </p>
          {currentDate === new Date().toISOString().split("T")[0] && (
            <span className="text-[10px] tracking-widest uppercase" style={{ color: "var(--accent)" }}>
              Aujourd'hui
            </span>
          )}
        </div>

        <button
          onClick={() => setDateIdx(i => Math.min(dates.length - 1, i + 1))}
          disabled={dateIdx === dates.length - 1}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-95 disabled:opacity-25"
          style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)", fontSize: "1.25rem" }}>
          ›
        </button>
      </div>

      {/* ── Sélecteur de gare ────────────────────────────────────────────────── */}
      {garesDispos.length > 0 && (
        <div className="relative">
          <select
            value={selectedGare}
            onChange={e => setSelectedGare(e.target.value)}
            className="w-full appearance-none rounded-xl px-4 py-3 pr-10 text-sm font-medium transition-all"
            style={{
              background: "var(--bg-input)",
              border: "1px solid var(--border)",
              color: "var(--text-main)",
              outline: "none",
            }}>
            {garesDispos.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          {/* Chevron */}
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs"
            style={{ color: "var(--text-muted)" }}>
            ▾
          </span>
        </div>
      )}

      {/* ── Contenu ──────────────────────────────────────────────────────────── */}
      {loadingData ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
        </div>
      ) : aucunTrajet ? (
        <div className="text-center py-12" style={{ color: "var(--text-muted)" }}>
          <p className="text-sm">Aucun trajet à {selectedGare} ce jour.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {arriveesFiltrees.length > 0 && (
            <ListeEntrees
              titre="Arrivées"
              emoji="🟢"
              entrees={arriveesFiltrees}
              couleurBadge="rgba(34,197,94,0.15)"
              couleurTexte="#4ade80"
            />
          )}
          {departsFiltres.length > 0 && (
            <ListeEntrees
              titre="Départs"
              emoji="🔴"
              entrees={departsFiltres}
              couleurBadge="rgba(248,113,113,0.12)"
              couleurTexte="#f87171"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Liste pour une section (arrivées ou départs) d'une seule gare ──────────────
function ListeEntrees({ titre, emoji, entrees, couleurBadge, couleurTexte }: {
  titre: string;
  emoji: string;
  entrees: Entree[];
  couleurBadge: string;
  couleurTexte: string;
}) {
  return (
    <div>
      {/* En-tête */}
      <div className="flex items-center gap-2 mb-2 px-1">
        <span>{emoji}</span>
        <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: "var(--text-sub)" }}>
          {titre}
        </p>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: couleurBadge, color: couleurTexte }}>
          {entrees.length} voyageur{entrees.length > 1 ? "s" : ""}
        </span>
        <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
      </div>

      {/* Liste */}
      <div className="rounded-2xl overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
        <div className="divide-y" style={{ borderColor: "var(--border)" }}>
          {entrees.map((e, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <span className="text-sm font-bold tabular-nums w-12 shrink-0"
                style={{ color: couleurTexte }}>
                {fmtHeure(e.heure)}
              </span>
              <span className="text-sm" style={{ color: "var(--text-main)" }}>
                {e.nomComplet}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}