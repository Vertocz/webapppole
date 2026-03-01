"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

// ─── Numéro autorisé ──────────────────────────────────────────────────────────
const ADMIN_PHONE = "0630358954";

type Statut = "renommé" | "ignoré" | "erreur";
interface Result {
  original: string;
  nouveau: string | null;
  statut: Statut;
  detail?: string;
}

const STATUT_STYLE: Record<Statut, { bg: string; color: string; icon: string }> = {
  "renommé": { bg: "rgba(34,197,94,0.08)",  color: "#86efac", icon: "✅" },
  "ignoré":  { bg: "rgba(100,116,139,0.08)", color: "#94a3b8", icon: "⏭" },
  "erreur":  { bg: "rgba(239,68,68,0.08)",  color: "#f87171", icon: "❌" },
};

export default function AdminPage() {
  const [phone, setPhone] = useState("");
  const [authError, setAuthError] = useState("");
  const [authed, setAuthed] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const router = useRouter();

  // ─── Auth locale ────────────────────────────────────────────────────────────
  const handleAuth = () => {
    const normalized = phone.replace(/\s/g, "").replace(/^\+33/, "0");
    if (normalized === ADMIN_PHONE) {
      setAuthed(true);
    } else {
      setAuthError("Accès refusé. Ce numéro n'est pas autorisé.");
    }
  };

  // ─── Lancement du renommage ──────────────────────────────────────────────────
  const handleRename = async () => {
    setRunning(true);
    setDone(false);
    setResults([]);
    setGlobalError(null);
    try {
      const res = await fetch("/api/admin/rename-billets", { method: "POST" });
      const json = await res.json();
      if (json.error) {
        setGlobalError(json.error);
      } else {
        setResults(json.results ?? []);
        setDone(true);
      }
    } catch (e) {
      setGlobalError("Erreur réseau ou serveur inaccessible.");
    } finally {
      setRunning(false);
    }
  };

  const renamed  = results.filter((r) => r.statut === "renommé").length;
  const ignored  = results.filter((r) => r.statut === "ignoré").length;
  const errored  = results.filter((r) => r.statut === "erreur").length;

  // ─── Écran d'auth ────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-4"
        style={{ background: "#05080F" }}>
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-4"
              style={{ background: "white", padding: "8px" }}>
              <Image src="/logo.png" alt="Logo" width={56} height={56} style={{ objectFit: "contain" }} />
            </div>
            <h1 className="font-display text-3xl" style={{ color: "#E8EEF8" }}>ESPACE ADMIN</h1>
            <p className="text-sm mt-1" style={{ color: "#3D5080" }}>Accès restreint</p>
          </div>

          <div className="rounded-2xl p-6 space-y-4"
            style={{ background: "#0B1120", border: "1px solid rgba(43,80,160,0.2)" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6B82B0", marginBottom: "0.5rem" }}>
                Numéro de téléphone
              </label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAuth()}
                placeholder="06 30 35 89 54"
                className="w-full px-4 py-3 rounded-xl text-lg outline-none"
                style={{ background: "#060A14", border: "1px solid rgba(43,80,160,0.2)", color: "#E8EEF8" }}
                autoFocus />
            </div>
            {authError && (
              <div className="rounded-lg px-4 py-3 text-sm"
                style={{ background: "rgba(232,25,44,0.08)", border: "1px solid rgba(232,25,44,0.2)", color: "#f87171" }}>
                {authError}
              </div>
            )}
            <button onClick={handleAuth}
              className="w-full py-3 rounded-xl font-display text-base tracking-widest"
              style={{ background: "linear-gradient(135deg, #1B3A8C, #2952CC)", color: "white" }}>
              ACCÉDER
            </button>
          </div>

          <button onClick={() => router.push("/")} className="w-full text-center text-sm"
            style={{ color: "#3D5080" }}>
            ← Retour à l'accueil
          </button>
        </div>
      </main>
    );
  }

  // ─── Interface admin ─────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen px-4 py-8" style={{ background: "#05080F" }}>
      {/* Stripe top */}
      <div className="fixed top-0 left-0 right-0 h-0.5 z-50"
        style={{ background: "linear-gradient(90deg, #1B3A8C, #C49A28, #1B3A8C)" }} />

      <div className="max-w-2xl mx-auto space-y-6 pt-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl overflow-hidden" style={{ background: "white", padding: "3px" }}>
              <Image src="/logo.png" alt="Logo" width={32} height={32} style={{ objectFit: "contain" }} />
            </div>
            <div>
              <h1 className="font-display text-xl leading-none" style={{ color: "#E8EEF8" }}>ADMIN</h1>
              <p className="text-xs" style={{ color: "#3D5080" }}>Gestion des billets</p>
            </div>
          </div>
          <button onClick={() => router.push("/")} className="px-3 py-1.5 rounded-lg text-xs"
            style={{ border: "1px solid rgba(43,80,160,0.2)", color: "#6B82B0" }}>
            ← Accueil
          </button>
        </div>

        {/* Card principale */}
        <div className="rounded-2xl p-6 space-y-4"
          style={{ background: "#0B1120", border: "1px solid rgba(43,80,160,0.15)" }}>

          <div>
            <h2 className="font-display text-2xl" style={{ color: "#E8EEF8" }}>
              RENOMMAGE DES BILLETS
            </h2>
            <p className="text-sm mt-1" style={{ color: "#6B82B0" }}>
              Analyse chaque PDF du bucket <strong style={{ color: "#E8EEF8" }}>Billets</strong> et
              le renomme au format <code style={{ color: "#C49A28", fontSize: "0.75rem" }}>VilleDepart-VilleArrivee_Prenom-Nom_AAAA-MM-JJ.pdf</code>
            </p>
          </div>

          {/* Formats supportés */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "TGV Inoui", icon: "🚄", color: "#F87171" },
              { label: "Ouigo",     icon: "🟣", color: "#A78BFA" },
              { label: "TER",       icon: "🚆", color: "#60A5FA" },
            ].map((f) => (
              <div key={f.label} className="rounded-xl px-3 py-2.5 text-center"
                style={{ background: `color-mix(in srgb, ${f.color} 8%, #0B1120)`, border: `1px solid color-mix(in srgb, ${f.color} 20%, transparent)` }}>
                <div className="text-lg">{f.icon}</div>
                <div className="text-xs font-medium mt-0.5" style={{ color: f.color }}>{f.label}</div>
              </div>
            ))}
          </div>

          {globalError && (
            <div className="rounded-lg px-4 py-3 text-sm"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}>
              ❌ {globalError}
            </div>
          )}

          <button onClick={handleRename} disabled={running}
            className="w-full py-3.5 rounded-xl font-display text-lg tracking-widest transition-all disabled:opacity-50"
            style={{ background: running ? "#0B1120" : "linear-gradient(135deg, #C49A28, #9A7818)", color: "white", boxShadow: running ? "none" : "0 4px 20px rgba(196,154,40,0.2)", border: running ? "1px solid rgba(196,154,40,0.2)" : "none" }}>
            {running ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin inline-block"
                  style={{ borderColor: "#C49A28", borderTopColor: "transparent" }} />
                Analyse en cours…
              </span>
            ) : done ? "🔄 RELANCER L'ANALYSE" : "▶ LANCER LE RENOMMAGE"}
          </button>
        </div>

        {/* Résultats */}
        {done && results.length > 0 && (
          <div className="space-y-4">
            {/* Résumé */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Renommés",  val: renamed,  color: "#86efac" },
                { label: "Ignorés",   val: ignored,  color: "#94a3b8" },
                { label: "Erreurs",   val: errored,  color: "#f87171" },
              ].map((s) => (
                <div key={s.label} className="rounded-xl p-4 text-center"
                  style={{ background: "#0B1120", border: "1px solid rgba(43,80,160,0.15)" }}>
                  <div className="font-display text-3xl" style={{ color: s.color }}>{s.val}</div>
                  <div className="text-xs mt-1" style={{ color: "#6B82B0" }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Liste détaillée */}
            <div className="space-y-2">
              {results.map((r, i) => {
                const style = STATUT_STYLE[r.statut];
                return (
                  <div key={i} className="rounded-xl p-4"
                    style={{ background: style.bg, border: `1px solid color-mix(in srgb, ${style.color} 20%, transparent)` }}>
                    <div className="flex items-start gap-3">
                      <span className="text-base shrink-0 mt-0.5">{style.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium" style={{ color: "#94a3b8" }}>
                          Avant : <span style={{ color: "#E8EEF8" }}>{r.original}</span>
                        </p>
                        {r.nouveau && r.nouveau !== r.original && (
                          <p className="text-xs mt-0.5" style={{ color: "#94a3b8" }}>
                            Après : <span style={{ color: style.color, fontWeight: 600 }}>{r.nouveau}</span>
                          </p>
                        )}
                        {r.detail && (
                          <p className="text-xs mt-0.5 italic" style={{ color: "#64748b" }}>{r.detail}</p>
                        )}
                      </div>
                      <span className="text-xs shrink-0 font-medium" style={{ color: style.color }}>
                        {r.statut}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {done && results.length === 0 && (
          <div className="rounded-xl p-6 text-center"
            style={{ background: "#0B1120", border: "1px solid rgba(43,80,160,0.15)" }}>
            <p className="text-sm" style={{ color: "#6B82B0" }}>Aucun fichier PDF trouvé dans le bucket.</p>
          </div>
        )}
      </div>
    </main>
  );
}
