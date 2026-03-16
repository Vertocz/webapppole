"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Card from "./Card";

const STORAGE_BASE =
  "https://fxvotvtapcwzvjhfreqv.supabase.co/storage/v1/object/public/Billets/";

interface Trajet {
  id: string;
  gare_depart: string;
  gare_arrivee: string;
  date_depart: string;      // "YYYY-MM-DD"
  heure_depart: string;     // "HH:MM:SS"
  heure_arrivee: string;    // "HH:MM:SS"
  type_train: string | null;
  numero_train: string | null;
}

interface BilletAvecTrajets {
  id: number;
  nom_fichier: string;
  url_stockage: string;
  trajets: Trajet[];
}

// ─── Formatage ─────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

function fmtHeure(t: string) {
  // "14:40:00" → "14h40"
  const [h, m] = t.split(":");
  return `${h}h${m}`;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function trainLabel(type: string | null, numero: string | null) {
  const parts = [type, numero].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

// ─── Couleur selon type de train ────────────────────────────────────────────────
function trainColor(type: string | null): string {
  const t = (type ?? "").toLowerCase();
  if (t.includes("ouigo"))  return "#5A1E96";
  if (t.includes("inoui"))  return "#C41E3A";
  if (t.includes("tgv"))    return "#C41E3A";
  if (t.includes("ter"))    return "#007DBA";
  if (t.includes("inter"))  return "#1A6B3C";
  return "#374151";
}


// ─── Carte trajet ───────────────────────────────────────────────────────────────
function TrajetCard({ trajet, urlPdf }: { trajet: Trajet; urlPdf: string }) {
  const color = trainColor(trajet.type_train);
  const label = trainLabel(trajet.type_train, trajet.numero_train);
  const isPast = new Date(trajet.date_depart + "T00:00:00") < new Date(new Date().toDateString());

  return (
    <div
      className="rounded-2xl overflow-hidden transition-all"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        opacity: isPast ? 0.65 : 1,
      }}
    >
      {/* Bande couleur train */}
      <div style={{ height: 3, background: color }} />

      <div className="px-4 py-4">
        {/* Ligne 1 : date + badge train */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
            {capitalize(fmtDate(trajet.date_depart))}
          </span>
          <div className="flex items-center gap-2">
            {isPast && (
              <span className="text-[10px] px-2 py-0.5 rounded-full"
                style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}>
                Passé
              </span>
            )}
            {label && (
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wider"
                style={{ background: `${color}18`, color, border: `1px solid ${color}33` }}
              >
                {label}
              </span>
            )}
          </div>
        </div>

        {/* Ligne 2 : itinéraire */}
        <div className="flex items-center gap-3">
          {/* Départ */}
          <div className="flex-1 min-w-0">
            <p className="font-display text-xl leading-none" style={{ color: "var(--text-main)" }}>
              {fmtHeure(trajet.heure_depart)}
            </p>
            <p className="text-xs mt-1 truncate font-medium" style={{ color: "var(--text-main)", opacity: 0.8 }}>
              {trajet.gare_depart}
            </p>
          </div>

          {/* Flèche centrale */}
          <div className="flex flex-col items-center gap-1 shrink-0 px-1">
            <div className="flex items-center gap-0.5">
              <div className="w-8 h-px" style={{ background: "var(--border)" }} />
              <div className="text-base" style={{ color: "var(--text-muted)" }}>→</div>
              <div className="w-8 h-px" style={{ background: "var(--border)" }} />
            </div>
          </div>

          {/* Arrivée */}
          <div className="flex-1 min-w-0 text-right">
            <p className="font-display text-xl leading-none" style={{ color: "var(--text-main)" }}>
              {fmtHeure(trajet.heure_arrivee)}
            </p>
            <p className="text-xs mt-1 truncate font-medium" style={{ color: "var(--text-main)", opacity: 0.8 }}>
              {trajet.gare_arrivee}
            </p>
          </div>
        </div>

        {/* Bouton PDF */}
        <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
          <a
            href={STORAGE_BASE + urlPdf}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-xs font-medium tracking-wider transition-all hover:opacity-85 active:scale-[0.98]"
            style={{
              background: `${color}14`,
              border: `1px solid ${color}33`,
              color,
            }}
          >
            <span>📄</span>
            <span>VOIR LE BILLET</span>
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Composant principal ────────────────────────────────────────────────────────
export default function Billets({ userId }: { userId: string }) {
  const [billets, setBillets] = useState<BilletAvecTrajets[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    supabase
      .from("billets")
      .select("id, nom_fichier, url_stockage, trajets(*)")
      .eq("joueuse_id", userId)
      .then(({ data }) => {
        if (!data) { setLoading(false); return; }

        // Trier les trajets de chaque billet par date_depart ASC
        const sorted = (data as BilletAvecTrajets[]).map((b) => ({
          ...b,
          trajets: [...(b.trajets ?? [])].sort((a, b) =>
            a.date_depart.localeCompare(b.date_depart) ||
            a.heure_depart.localeCompare(b.heure_depart)
          ),
        }));

        // Trier les billets par leur premier trajet
        sorted.sort((a, b) => {
          const da = a.trajets[0]?.date_depart ?? "";
          const db = b.trajets[0]?.date_depart ?? "";
          return da.localeCompare(db) ||
            (a.trajets[0]?.heure_depart ?? "").localeCompare(b.trajets[0]?.heure_depart ?? "");
        });

        setBillets(sorted);
        setLoading(false);
      });
  }, [userId]);

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
    </div>
  );

  // Aplatir tous les trajets pour séparer passés / à venir
  const today = new Date(new Date().toDateString());
  const allTrajets: { trajet: Trajet; urlPdf: string }[] = [];
  for (const b of billets) {
    for (const t of b.trajets) {
      allTrajets.push({ trajet: t, urlPdf: b.url_stockage });
    }
  }

  // Billets sans trajets détectés (fallback affichage simple)
  const billetsOrphelins = billets.filter((b) => b.trajets.length === 0);

  const aVenir  = allTrajets.filter(({ trajet }) => new Date(trajet.date_depart + "T00:00:00") >= today);
  const passes  = allTrajets.filter(({ trajet }) => new Date(trajet.date_depart + "T00:00:00") < today);

  if (allTrajets.length === 0 && billetsOrphelins.length === 0) return (
    <Card>
      <div className="text-center py-8">
        <span className="text-5xl block mb-4">🎫</span>
        <p style={{ color: "var(--text-muted)" }}>Aucun billet disponible pour le moment.</p>
      </div>
    </Card>
  );

  return (
    <div className="space-y-5">
      <h2 className="font-display text-2xl" style={{ color: "var(--text-main)" }}>
        BILLETS DE TRAIN
      </h2>

      {/* ── Billets à venir ── */}
      {aVenir.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold tracking-widest uppercase"
            style={{ color: "var(--text-muted)" }}>
            À venir · {aVenir.length} trajet{aVenir.length > 1 ? "s" : ""}
          </p>
          {aVenir.map(({ trajet, urlPdf }) => (
            <div key={trajet.id} className="animate-fade-in-up">
              <TrajetCard trajet={trajet} urlPdf={urlPdf} />
            </div>
          ))}
        </div>
      )}

      {/* ── Séparateur + toggle passés ── */}
      {passes.length > 0 && (
        <div>
          <button
            onClick={() => setShowPast((p) => !p)}
            className="flex items-center gap-2 text-xs font-semibold tracking-widest uppercase transition-opacity hover:opacity-70 w-full"
            style={{ color: "var(--text-muted)" }}
          >
            <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
            <span>{showPast ? "▲" : "▼"}</span>
            <span>{passes.length} trajet{passes.length > 1 ? "s" : ""} passé{passes.length > 1 ? "s" : ""}</span>
            <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
          </button>

          {showPast && (
            <div className="space-y-3 mt-3">
              {passes.map(({ trajet, urlPdf }) => (
                <div key={trajet.id} className="animate-fade-in-up">
                  <TrajetCard trajet={trajet} urlPdf={urlPdf} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Billets orphelins (pas de trajets parsés) ── */}
      {billetsOrphelins.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-widest uppercase"
            style={{ color: "var(--text-muted)" }}>
            Billets non traités
          </p>
          {billetsOrphelins.map((b) => (
            <Card key={b.id}>
              <div className="flex items-center gap-4">
                <span className="text-2xl">🎫</span>
                <p className="flex-1 text-sm truncate" style={{ color: "var(--text-muted)" }}>
                  {b.nom_fichier}
                </p>
                <a href={STORAGE_BASE + b.url_stockage} target="_blank" rel="noreferrer"
                  className="text-xs px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85"
                  style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                  Ouvrir
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
