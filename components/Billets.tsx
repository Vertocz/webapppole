"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import Card from "./Card";
import { getCachedBilletPdf, isOnline, syncBilletsPdf } from "@/lib/offline";
import { todayISO } from "@/lib/dates";

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

// ─── Chargement + copie hors ligne des PDF ─────────────────────────────────────
export async function loadBillets(userId: string): Promise<BilletAvecTrajets[] | null> {
  const { data } = await supabase
    .from("billets")
    .select("id, nom_fichier, url_stockage, trajets(*)")
    .eq("joueuse_id", userId);
  if (!data) return null;

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
  return sorted;
}

/** PDF à garder sur l'appareil : billets avec un trajet à venir + billets non traités. */
function pdfUrlsToKeep(billets: BilletAvecTrajets[]): string[] {
  const today = todayISO();
  const urls = billets
    .filter((b) => b.trajets.length === 0 || b.trajets.some((t) => t.date_depart >= today))
    .map((b) => STORAGE_BASE + b.url_stockage);
  return [...new Set(urls)];
}

/** À appeler à l'ouverture de l'app : les billets seront consultables sans réseau. */
export async function prefetchBilletsOffline(userId: string) {
  const billets = await loadBillets(userId);
  if (billets) await syncBilletsPdf(pdfUrlsToKeep(billets));
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
function TrajetCard({ trajet, urlPdf, offlineReady, onOpen }: {
  trajet: Trajet; urlPdf: string; offlineReady: boolean; onOpen: (e: React.MouseEvent, url: string) => void;
}) {
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
            onClick={(e) => onOpen(e, STORAGE_BASE + urlPdf)}
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
          {!isPast && (
            <p className="text-[10px] text-center mt-2 tracking-wider" style={{ color: "var(--text-muted)" }}>
              {offlineReady ? "✓ Disponible hors ligne" : "Pas encore enregistré pour le hors ligne"}
            </p>
          )}
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
  const [offline, setOffline] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadBillets(userId).then((sorted) => {
      if (!alive) return;
      if (sorted) {
        setBillets(sorted);
        syncBilletsPdf(pdfUrlsToKeep(sorted)).then((s) => { if (alive) setOffline(s); });
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [userId]);

  // Libère l'URL locale du PDF à la fermeture
  useEffect(() => () => { if (viewer) URL.revokeObjectURL(viewer.url); }, [viewer]);

  // Sans réseau : on ouvre la copie gardée sur l'appareil
  const handleOpen = async (e: React.MouseEvent, url: string) => {
    if (isOnline()) return;
    e.preventDefault();
    setOpenError(null);
    const blob = await getCachedBilletPdf(url);
    if (!blob) {
      setOpenError("Ce billet n'a pas encore été enregistré sur ton téléphone. Ouvre l'app avec du réseau pour le récupérer.");
      return;
    }
    const pdf = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
    setViewer({ url: URL.createObjectURL(pdf), name: decodeURIComponent(url.split("/").pop() ?? "billet.pdf") });
  };

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

      {openError && (
        <div className="rounded-lg px-4 py-3 text-sm animate-slide-in"
          style={{ background: "rgba(232,160,25,0.08)", border: "1px solid rgba(232,160,25,0.25)", color: "#F2C46D" }}>
          {openError}
        </div>
      )}

      {viewer && <PdfViewer url={viewer.url} name={viewer.name} onClose={() => setViewer(null)} />}

      {/* ── Billets à venir ── */}
      {aVenir.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold tracking-widest uppercase"
            style={{ color: "var(--text-muted)" }}>
            À venir · {aVenir.length} trajet{aVenir.length > 1 ? "s" : ""}
          </p>
          {aVenir.map(({ trajet, urlPdf }) => (
            <div key={trajet.id} className="animate-fade-in-up">
              <TrajetCard trajet={trajet} urlPdf={urlPdf} offlineReady={offline.has(STORAGE_BASE + urlPdf)} onOpen={handleOpen} />
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
                  <TrajetCard trajet={trajet} urlPdf={urlPdf} offlineReady={offline.has(STORAGE_BASE + urlPdf)} onOpen={handleOpen} />
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
                  onClick={(e) => handleOpen(e, STORAGE_BASE + b.url_stockage)}
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


// ─── Visionneuse PDF hors ligne ─────────────────────────────────────────────────
function PdfViewer({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const share = async () => {
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], name, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return;
      }
    } catch { /* partage annulé ou indisponible */ }
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Portail vers <body> : passe au-dessus de toute l'interface (bandeau compris)
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col" style={{ background: "var(--bg-base)" }}>
      <div className="flex items-center gap-2 px-4 py-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)", borderBottom: "1px solid var(--border)" }}>
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm font-medium"
          style={{ border: "1px solid var(--border)", color: "var(--text-main)" }}>
          ✕ Fermer
        </button>
        <p className="flex-1 text-xs truncate" style={{ color: "var(--text-muted)" }}>{name}</p>
        <button onClick={share} className="px-3 py-1.5 rounded-lg text-sm font-medium"
          style={{ background: "var(--primary)", color: "white" }}>
          Ouvrir / Enregistrer
        </button>
      </div>
      <iframe src={url} title="Billet" className="flex-1 w-full" style={{ background: "white", border: 0 }} />
      <p className="text-[11px] text-center px-4 py-2" style={{ color: "var(--text-muted)", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}>
        Billet enregistré sur ton téléphone. S&apos;il ne s&apos;affiche pas, appuie sur « Ouvrir / Enregistrer ».
      </p>
    </div>,
    document.body
  );
}
