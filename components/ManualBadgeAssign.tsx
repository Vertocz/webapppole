"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";

const AUTHORIZED_PHONE = "0630358954";
const accent = "#E8641C";

const GITHUB_TOKEN = process.env.NEXT_PUBLIC_GITHUB_TOKEN ?? "";
const GITHUB_REPO  = process.env.NEXT_PUBLIC_GITHUB_REPO  ?? "";

interface Player {
  id: string;
  prenom: string;
  nom: string;
  categorie?: string;
  numero_tel: string;
}

interface BadgeRow {
  id: string;
  nom: string;
  description: string;
  image_url_masc: string | null;
  image_url_fem:  string | null;
}

interface Props {
  staffPhone: string;
  staffId:    string;
}

type Step = "players" | "badge" | "confirm" | "done";

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function BadgeImg({ src, size = 48 }: { src: string | null; size?: number }) {
  const [ok, setOk] = useState(true);
  if (!src || !ok) return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center",
      justifyContent: "center", fontSize: size * 0.5, flexShrink: 0 }}>🏅</div>
  );
  return (
    <Image src={src} alt="" width={size} height={size}
      className="object-contain flex-shrink-0" onError={() => setOk(false)} />
  );
}

// ── Point d'entrée ─────────────────────────────────────────────────────────────
export default function ManualBadgeAssign({ staffPhone }: Props) {
  if (staffPhone !== AUTHORIZED_PHONE) return null;
  return <ManualBadgeAssignInner />;
}

// ── Sélecteur d'image depuis GitHub ───────────────────────────────────────────
function ImagePicker({ value, onChange }: { value: string; onChange: (f: string) => void }) {
  const [files,   setFiles]   = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");

  useEffect(() => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) { setLoading(false); return; }
    fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/public/badges`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
    })
      .then(r => r.json())
      .then((data: { name: string; type: string }[]) => {
        if (!Array.isArray(data)) return;
        setFiles(
          data
            .filter(f => f.type === "file" && /\.(png|jpg|webp|svg)$/i.test(f.name))
            .map(f => f.name)
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = files.filter(f => f.toLowerCase().includes(search.toLowerCase()));

  const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(43,80,160,0.25)",
    color: "var(--text-main)", borderRadius: "0.5rem",
    padding: "0.4rem 0.65rem", fontSize: "0.8rem", outline: "none", width: "100%",
  };

  if (loading) return (
    <div className="flex items-center gap-2 py-1">
      <div className="w-4 h-4 rounded-full border-2 animate-spin flex-shrink-0"
        style={{ borderColor: accent, borderTopColor: "transparent" }} />
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>Chargement des images…</span>
    </div>
  );

  if (!files.length) return (
    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
      Aucune image trouvée dans public/badges
    </p>
  );

  return (
    <div className="space-y-2">
      <input placeholder="Rechercher une image…" value={search}
        onChange={e => setSearch(e.target.value)} style={inputStyle} />
      <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">
        {filtered.map(f => {
          const selected = value === f;
          return (
            <button key={f} onClick={() => onChange(selected ? "" : f)} type="button"
              className="rounded-xl p-2 flex flex-col items-center gap-1 transition-all"
              style={{
                background: selected ? `${accent}20` : "rgba(255,255,255,0.03)",
                border: `1px solid ${selected ? accent + "66" : "rgba(43,80,160,0.15)"}`,
              }}>
              <BadgeImg src={`/badges/${f}`} size={40} />
              <span className="text-[9px] text-center leading-tight truncate w-full"
                style={{ color: selected ? accent : "var(--text-muted)" }}>
                {f.replace(/\.[^.]+$/, "")}
              </span>
            </button>
          );
        })}
      </div>
      {value && (
        <p className="text-[11px]" style={{ color: accent }}>✓ {value}</p>
      )}
    </div>
  );
}

// ── Composant principal ────────────────────────────────────────────────────────
function ManualBadgeAssignInner() {
  const [step,            setStep]            = useState<Step>("players");
  const [players,         setPlayers]         = useState<Player[]>([]);
  const [manualBadges,    setManualBadges]    = useState<BadgeRow[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(new Set());
  const [selectedBadge,   setSelectedBadge]   = useState<BadgeRow | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [submitting,      setSubmitting]       = useState(false);
  const [error,           setError]           = useState("");
  const [alreadyHas,      setAlreadyHas]      = useState<string[]>([]);
  // badge_id → set des joueur_ids qui l'ont déjà
  const [ownedMap, setOwnedMap] = useState<Map<string, Set<string>>>(new Map());

  // ── État création badge ─────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [creating,   setCreating]   = useState(false);
  const [createErr,  setCreateErr]  = useState("");
  const [newBadge, setNewBadge] = useState({
    nom: "", description: "",
    img_masc: "", img_fem: "",
    masculin: true,  feminin: false,
    joueurs:  true,  staff:   false,
  });

  const loadData = useCallback(async () => {
    const [{ data: joueuses }, { data: badges }] = await Promise.all([
      supabase.from("joueuses").select("id, prenom, nom, categorie, numero_tel").order("nom"),
      supabase.from("badges")
        .select("id, nom, description, image_url_masc, image_url_fem")
        .eq("type", "manuel").order("nom"),
    ]);
    setPlayers(joueuses ?? []);
    setManualBadges(badges ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Création ────────────────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!newBadge.nom.trim())                    { setCreateErr("Le nom est obligatoire."); return; }
    if (!newBadge.masculin && !newBadge.feminin) { setCreateErr("Choisis au moins Masculin ou Féminin."); return; }
    if (!newBadge.joueurs  && !newBadge.staff)   { setCreateErr("Choisis au moins Joueurs ou Staff."); return; }
    setCreating(true);
    setCreateErr("");

    const { error: err } = await supabase.from("badges").insert({
      id:             slugify(newBadge.nom),
      nom:            newBadge.nom.trim(),
      description:    newBadge.description.trim(),
      type:           "manuel",
      masculin:       newBadge.masculin,
      feminin:        newBadge.feminin,
      joueurs:        newBadge.joueurs,
      staff:          newBadge.staff,
      image_url_masc: newBadge.img_masc ? `/badges/${newBadge.img_masc}` : null,
      image_url_fem:  newBadge.img_fem  ? `/badges/${newBadge.img_fem}`  : null,
    });

    setCreating(false);
    if (err) { setCreateErr(err.message); return; }
    setNewBadge({ nom: "", description: "", img_masc: "", img_fem: "",
      masculin: true, feminin: false, joueurs: true, staff: false });
    setShowCreate(false);
    loadData();
  }, [newBadge, loadData]);

  // ── Attribution ─────────────────────────────────────────────────────────────
  const togglePlayer = useCallback((id: string) => {
    setSelectedPlayers(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleBadgeChosen = useCallback(async (badge: BadgeRow) => {
    setSelectedBadge(badge);
    if (selectedPlayers.size === 0) return;
    const { data } = await supabase.from("badges_joueur").select("joueur_id")
      .eq("badge_id", badge.id).in("joueur_id", [...selectedPlayers]);
    setAlreadyHas((data ?? []).map(r => r.joueur_id));
    setStep("confirm");
  }, [selectedPlayers]);

  const handleSubmit = useCallback(async () => {
    if (!selectedBadge) return;
    setSubmitting(true);
    setError("");
    const newPlayers = [...selectedPlayers].filter(id => !alreadyHas.includes(id));
    if (newPlayers.length > 0) {
      const { error: err } = await supabase.from("badges_joueur").insert(
        newPlayers.map(joueur_id => ({
          joueur_id, joueur_type: "joueur",
          badge_id: selectedBadge.id,
          unlocked_at: new Date().toISOString(),
        }))
      );
      if (err) { setError("Erreur : " + err.message); setSubmitting(false); return; }
    }
    setSubmitting(false);
    setStep("done");
  }, [selectedBadge, selectedPlayers, alreadyHas]);

  const reset = useCallback(() => {
    setStep("players"); setSelectedPlayers(new Set());
    setSelectedBadge(null); setAlreadyHas([]); setError("");
  }, []);

  // ── Helpers UI ──────────────────────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(43,80,160,0.25)",
    color: "var(--text-main)", borderRadius: "0.625rem",
    padding: "0.5rem 0.75rem", fontSize: "0.8125rem", width: "100%", outline: "none",
  };

  const toggle = (field: "masculin" | "feminin" | "joueurs" | "staff") =>
    setNewBadge(p => ({ ...p, [field]: !p[field] }));

  const ToggleChip = ({ field, label }: { field: "masculin" | "feminin" | "joueurs" | "staff"; label: string }) => (
    <button type="button" onClick={() => toggle(field)}
      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
      style={{
        background: newBadge[field] ? `${accent}25` : "rgba(255,255,255,0.04)",
        border: `1px solid ${newBadge[field] ? accent + "55" : "rgba(43,80,160,0.2)"}`,
        color: newBadge[field] ? accent : "var(--text-muted)",
      }}>
      {newBadge[field] ? "✓ " : ""}{label}
    </button>
  );

  if (loading) return (
    <div className="flex justify-center py-8">
      <div className="w-6 h-6 rounded-full border-2 animate-spin"
        style={{ borderColor: accent, borderTopColor: "transparent" }} />
    </div>
  );

  return (
    <div className="space-y-4">

      {/* ── Formulaire de création ──────────────────────────────────────────── */}
      {showCreate && (
        <div className="rounded-2xl overflow-hidden"
          style={{ border: `1px solid ${accent}33`, background: "rgba(232,100,28,0.04)" }}>
          <div className="px-4 py-3 flex items-center justify-between"
            style={{ borderBottom: `1px solid ${accent}1A` }}>
            <p className="text-xs font-bold tracking-widest uppercase" style={{ color: accent }}>
              NOUVEAU BADGE
            </p>
            <button onClick={() => { setShowCreate(false); setCreateErr(""); }}
              className="text-lg leading-none" style={{ color: "var(--text-muted)" }}>×</button>
          </div>

          <div className="p-4 space-y-4">
            {/* Nom */}
            <div>
              <p className="text-[11px] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-sub)" }}>Nom *</p>
              <input value={newBadge.nom}
                onChange={e => setNewBadge(p => ({ ...p, nom: e.target.value }))}
                placeholder="Ex : Tireur d'élite" style={inputStyle} />
              {newBadge.nom && (
                <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
                  ID généré : <span style={{ color: accent }}>{slugify(newBadge.nom)}</span>
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <p className="text-[11px] uppercase tracking-widest mb-1.5" style={{ color: "var(--text-sub)" }}>Description</p>
              <textarea value={newBadge.description} rows={2}
                onChange={e => setNewBadge(p => ({ ...p, description: e.target.value }))}
                placeholder="Condition pour obtenir ce badge…"
                style={{ ...inputStyle, resize: "none" }} />
            </div>

            {/* Cibles */}
            <div>
              <p className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--text-sub)" }}>Cible</p>
              <div className="flex flex-wrap gap-2">
                <ToggleChip field="masculin" label="Masculin" />
                <ToggleChip field="feminin"  label="Féminin"  />
                <ToggleChip field="joueurs"  label="Joueurs"  />
                <ToggleChip field="staff"    label="Staff"    />
              </div>
            </div>

            {/* Image masc */}
            <div>
              <p className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--text-sub)" }}>
                Image masculine{newBadge.img_masc ? <span style={{ color: accent }}> ✓</span> : ""}
              </p>
              <ImagePicker value={newBadge.img_masc}
                onChange={f => setNewBadge(p => ({ ...p, img_masc: f }))} />
            </div>

            {/* Image fém */}
            <div>
              <p className="text-[11px] uppercase tracking-widest mb-2" style={{ color: "var(--text-sub)" }}>
                Image féminine{newBadge.img_fem ? <span style={{ color: accent }}> ✓</span> : ""}
              </p>
              <ImagePicker value={newBadge.img_fem}
                onChange={f => setNewBadge(p => ({ ...p, img_fem: f }))} />
            </div>

            {createErr && (
              <p className="text-xs rounded-lg px-3 py-2"
                style={{ background: "rgba(248,113,113,0.1)", color: "#f87171",
                  border: "1px solid rgba(248,113,113,0.2)" }}>
                {createErr}
              </p>
            )}

            <button onClick={handleCreate} disabled={creating || !newBadge.nom.trim()}
              className="w-full py-3 rounded-xl font-display text-sm tracking-widest transition-all disabled:opacity-40"
              style={{ background: `linear-gradient(135deg, ${accent}88, ${accent})`, color: "white" }}>
              {creating ? "Création…" : "CRÉER LE BADGE"}
            </button>
          </div>
        </div>
      )}

      {/* ── Bloc attribution ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-5 space-y-5"
        style={{ background: "#0B1120", border: "1px solid rgba(43,80,160,0.2)" }}>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg"
              style={{ background: `${accent}20` }}>🏅</div>
            <div>
              <h3 className="font-display text-base" style={{ color: "var(--text-main)" }}>
                ATTRIBUTION MANUELLE
              </h3>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Récompense un·e ou plusieurs joueur·euses
              </p>
            </div>
          </div>
          <button onClick={() => { setShowCreate(v => !v); setCreateErr(""); }}
            title={showCreate ? "Fermer" : "Créer un badge"}
            className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-base transition-all hover:scale-105 active:scale-95"
            style={{
              background: showCreate ? `${accent}30` : `${accent}18`,
              color: accent, border: `1px solid ${accent}44`,
            }}>
            {showCreate ? "×" : "+"}
          </button>
        </div>

        {/* Étape 1 */}
        {step === "players" && (
          <>
            <p className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-sub)" }}>
              1 / 2 — Choix des joueur·euses
            </p>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {players.map(p => {
                const selected = selectedPlayers.has(p.id);
                return (
                  <button key={p.id} onClick={() => togglePlayer(p.id)}
                    className="w-full flex items-center gap-3 rounded-xl px-4 py-3 transition-all text-left"
                    style={{
                      background: selected ? `${accent}15` : "rgba(255,255,255,0.03)",
                      border: `1px solid ${selected ? accent + "55" : "rgba(43,80,160,0.15)"}`,
                    }}>
                    <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all"
                      style={{ borderColor: selected ? accent : "rgba(43,80,160,0.4)",
                        background: selected ? accent : "transparent" }}>
                      {selected && <span className="text-white text-[10px] font-bold">✓</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold" style={{ color: "var(--text-main)" }}>
                        {p.prenom} {p.nom.toUpperCase()}
                      </p>
                      {p.categorie && (
                        <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>{p.categorie}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            <button disabled={selectedPlayers.size === 0} onClick={async () => {
              // Charger les badges déjà obtenus par les joueurs sélectionnés
              const ids = [...selectedPlayers];
              const { data } = await supabase
                .from("badges_joueur")
                .select("badge_id, joueur_id")
                .eq("joueur_type", "joueur")
                .in("joueur_id", ids);
              const map = new Map<string, Set<string>>();
              (data ?? []).forEach(({ badge_id, joueur_id }) => {
                if (!map.has(badge_id)) map.set(badge_id, new Set());
                map.get(badge_id)!.add(joueur_id);
              });
              setOwnedMap(map);
              setStep("badge");
            }}
              className="w-full py-3.5 rounded-xl font-display text-sm tracking-widest transition-all"
              style={{
                background: selectedPlayers.size > 0
                  ? `linear-gradient(135deg, ${accent}88, ${accent})` : "rgba(255,255,255,0.05)",
                color: selectedPlayers.size > 0 ? "white" : "var(--text-muted)",
                opacity: selectedPlayers.size > 0 ? 1 : 0.5,
              }}>
              SUIVANT ({selectedPlayers.size} sélectionné{selectedPlayers.size > 1 ? "s" : ""})
            </button>
          </>
        )}

        {/* Étape 2 */}
        {step === "badge" && (
          <>
            <div className="flex items-center gap-2">
              <button onClick={() => setStep("players")} className="text-xs px-2 py-1 rounded-lg"
                style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}>
                ← Retour
              </button>
              <p className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-sub)" }}>
                2 / 2 — Choix du badge
              </p>
            </div>
            {manualBadges.length === 0 ? (
              <p className="text-sm text-center py-6" style={{ color: "var(--text-muted)" }}>
                Aucun badge manuel — crée-en un avec le bouton +
              </p>
            ) : manualBadges.filter(b => {
                const owners = ownedMap.get(b.id) ?? new Set();
                return [...selectedPlayers].some(id => !owners.has(id));
              }).length === 0 ? (
              <p className="text-sm text-center py-6" style={{ color: "var(--text-muted)" }}>
                Les joueurs sélectionnés ont déjà tous les badges disponibles.
              </p>
            ) : (
              <div className="space-y-2">
                {manualBadges
                  .filter(b => {
                    const owners = ownedMap.get(b.id) ?? new Set();
                    // Afficher seulement si au moins 1 joueur sélectionné n'a pas encore ce badge
                    return [...selectedPlayers].some(id => !owners.has(id));
                  })
                  .map(b => (
                  <button key={b.id} onClick={() => handleBadgeChosen(b)}
                    className="w-full flex items-center gap-4 rounded-xl px-4 py-3 transition-all text-left hover:scale-[1.01] active:scale-[0.99]"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(43,80,160,0.15)" }}>
                    <BadgeImg src={b.image_url_masc ?? b.image_url_fem} size={48} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold" style={{ color: "var(--text-main)" }}>{b.nom}</p>
                      <p className="text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>{b.description}</p>
                    </div>
                    <span style={{ color: "var(--text-muted)" }}>›</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Étape 3 */}
        {step === "confirm" && selectedBadge && (
          <>
            <p className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-sub)" }}>
              Confirmation
            </p>
            <div className="rounded-xl p-4 text-center"
              style={{ background: `${accent}10`, border: `1px solid ${accent}33` }}>
              <div className="flex justify-center mb-2">
                <BadgeImg src={selectedBadge.image_url_masc ?? selectedBadge.image_url_fem} size={80} />
              </div>
              <p className="font-bold text-base" style={{ color: "var(--text-main)" }}>{selectedBadge.nom}</p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{selectedBadge.description}</p>
            </div>
            <div className="space-y-1">
              {[...selectedPlayers].map(id => {
                const p    = players.find(pl => pl.id === id)!;
                const skip = alreadyHas.includes(id);
                return (
                  <div key={id} className="flex items-center justify-between text-sm px-1">
                    <span style={{ color: skip ? "var(--text-muted)" : "var(--text-main)" }}>
                      {p.prenom} {p.nom.toUpperCase()}
                    </span>
                    <span className="text-[11px] font-bold" style={{ color: skip ? "#6B82B0" : "#63C878" }}>
                      {skip ? "Déjà obtenu" : "✓ À attribuer"}
                    </span>
                  </div>
                );
              })}
            </div>
            {error && (
              <p className="text-xs text-center" style={{ color: "#f87171" }}>{error}</p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setStep("badge")}
                className="flex-1 py-3 rounded-xl text-sm font-display tracking-widest"
                style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}>
                RETOUR
              </button>
              <button onClick={handleSubmit}
                disabled={submitting || [...selectedPlayers].every(id => alreadyHas.includes(id))}
                className="flex-1 py-3 rounded-xl text-sm font-display tracking-widest transition-all"
                style={{ background: `linear-gradient(135deg, ${accent}88, ${accent})`,
                  color: "white", opacity: submitting ? 0.6 : 1 }}>
                {submitting ? "…" : "ATTRIBUER"}
              </button>
            </div>
          </>
        )}

        {/* Étape 4 */}
        {step === "done" && (
          <div className="text-center py-6 space-y-4">
            <div className="text-5xl">🎉</div>
            <p className="font-display text-lg" style={{ color: "var(--text-main)" }}>Badge attribué !</p>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Le badge <strong>{selectedBadge?.nom}</strong> a été attribué avec succès.
            </p>
            <button onClick={reset} className="px-8 py-3 rounded-xl font-display text-sm tracking-widest"
              style={{ background: `linear-gradient(135deg, ${accent}88, ${accent})`, color: "white" }}>
              NOUVELLE ATTRIBUTION
            </button>
          </div>
        )}
      </div>
    </div>
  );
}