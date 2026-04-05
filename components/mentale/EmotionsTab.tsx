"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { SuiviEmotion } from "@/types";
import Card from "../Card";
import SliderField from "../SliderField";

// ─── Configuration ────────────────────────────────────────────────────────────
const EMOTIONS = [
  { nom: "Calme",       emoji: "😌", couleur: "#FBBF24", imagePath: "calme.png" },
  { nom: "Concentré",   emoji: "🎯", couleur: "#34D399", imagePath: "concentre.png" },
  { nom: "Créatif",     emoji: "👨‍🎨", couleur: "#60A5FA", imagePath: "creatif.png" },
  { nom: "Dégoûté",     emoji: "🤢", couleur: "#F87171", imagePath: "degoute.png" },
  { nom: "Epuisé",      emoji: "😩", couleur: "#818CF8", imagePath: "epuise.png" },
  { nom: "Fort",        emoji: "💪", couleur: "#F472B6", imagePath: "fort.png" },
  { nom: "Frustré",     emoji: "😖", couleur: "#6EE7B7", imagePath: "frustre.png" },
  { nom: "Inquiet",     emoji: "😰", couleur: "#FCA5A5", imagePath: "inquiet.png" },
  { nom: "Joyeux",      emoji: "😄", couleur: "#86efac", imagePath: "joyeux.png" },
  { nom: "Motivé",      emoji: "🏃", couleur: "#FDE68A", imagePath: "motive.png" },
  { nom: "Fier",        emoji: "🏆", couleur: "#F59E0B", imagePath: "fier.png" },
  { nom: "Déçu",        emoji: "😞", couleur: "#94A3B8", imagePath: "decu.png" },
  { nom: "En colère",   emoji: "😤", couleur: "#EF4444", imagePath: "en_colere.png" },
  { nom: "Jaloux",      emoji: "😒", couleur: "#10B981", imagePath: "jaloux.png" },
  { nom: "Déterminé",   emoji: "🔥", couleur: "#FB923C", imagePath: "determine.png" },
];

const DECLENCHEURS_OPTIONS = [
  { id: "arbitre",     label: "Décision Arbitrale", img: "arbitre.png" },
  { id: "erreur",      label: "Une Erreur",          img: "erreur.png" },
  { id: "trop_plein",  label: "Trop plein",          img: "trop_plein.png" },
  { id: "equipe",      label: "L'équipe",            img: "equipe.png" },
  { id: "panier",      label: "Un Panier",           img: "panier.png" },
  { id: "staff",       label: "Staff",               img: "staff.png" },
  { id: "partenaire",  label: "Un partenaire",       img: "partenaire.png" },
  { id: "supporter",   label: "Un supporter",        img: "supporter.png" },
  { id: "blessure",    label: "Une blessure",        img: "blessure.png" },
];

const OUTILS_OPTIONS = [
  { id: "respiration",    label: "Respiration",        img: "respiration.jpg" },
  { id: "discours",       label: "Discours Intérieur", img: "discours.png" },
  { id: "visualisation",  label: "Visualisation",      img: "visualisation.png" },
  { id: "bulle",          label: "Dans ma bulle",      img: "bulle.png" },
  { id: "cri_de_guerre",  label: "Cri de guerre",      img: "cri_de_guerre.png" },
];

const EXPRESSIONS = [
  { val: "happy",   icon: "🙂" },
  { val: "neutral", icon: "😐" },
  { val: "sad",     icon: "☹️" },
];

const PENSEES_TYPES = [
  { val: "troubled", icon: "☁️",  label: "Nuageux" },
  { val: "stormy",   icon: "🌪️", label: "Tornade" },
  { val: "calm",     icon: "🌴",  label: "Palmier" },
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface EmotionEntry {
  emotion: typeof EMOTIONS[0];
  intensite: number;
  selectedDeclencheurs: string[];
  declencheurAutre: string;
  selectedOutils: string[];
  outilsAutre: string;
  expression: string;
  pensees_type: string;
}

// SuiviEmotion étendu avec les champs optionnels stockés dans metadata
type SuiviEmotionFull = SuiviEmotion & { metadata?: { expression?: string; pensees_type?: string } };

const labelStyle = {
  display: "block", fontSize: "0.7rem", fontWeight: 600,
  letterSpacing: "0.12em", textTransform: "uppercase" as const,
  color: "var(--text-sub)", marginBottom: "0.5rem",
};
const inputStyle = {
  background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)",
} as React.CSSProperties;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildPayload(userId: string, dateS: string, nom: string, entry: EmotionEntry) {
  const finalDeclencheurs = [
    ...DECLENCHEURS_OPTIONS.filter((o) => entry.selectedDeclencheurs.includes(o.id)).map((o) => o.label),
    entry.declencheurAutre,
  ].filter(Boolean).join(", ");

  const finalOutils = [
    ...OUTILS_OPTIONS.filter((o) => entry.selectedOutils.includes(o.id)).map((o) => o.label),
    entry.outilsAutre,
  ].filter(Boolean).join(", ");

  return {
    joueur_id: userId,
    date: dateS,
    emotion_nom: nom,
    intensite: entry.intensite,
    declencheur: finalDeclencheurs,
    ressources: finalOutils,
    metadata: JSON.stringify({ expression: entry.expression, pensees_type: entry.pensees_type }),
  };
}

function IconBtn({ onClick, icon, danger = false, title }: { onClick: () => void; icon: string; danger?: boolean; title: string }) {
  return (
    <button onClick={onClick} title={title}
      className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors shrink-0"
      style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
      onMouseEnter={(e) => (e.currentTarget.style.color = danger ? "#f87171" : "var(--text-main)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
      {icon}
    </button>
  );
}

// Placeholder affiché quand l'image est absente
function EmotionPlaceholder({ emoji, couleur }: { emoji: string; couleur: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center text-2xl rounded-lg"
      style={{ background: `color-mix(in srgb, ${couleur} 15%, var(--bg-card))` }}>
      {emoji}
    </div>
  );
}

// ─── Composant ────────────────────────────────────────────────────────────────
export default function EmotionsTab({ userId, readOnly = false }: { userId: string; readOnly?: boolean }) {
  const [historique, setHistorique] = useState<SuiviEmotionFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<SuiviEmotionFull | null>(null);

  // Suivi des images manquantes pour afficher le placeholder emoji
  const [imgErrors, setImgErrors] = useState<Set<string>>(new Set());

  const [selectedEmotions, setSelectedEmotions] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState<Record<string, EmotionEntry>>({});
  const [activeEmotion, setActiveEmotion] = useState<string | null>(null);
  const [dateS, setDateS] = useState(new Date().toISOString().split("T")[0]);

  // ── Chargement historique ──
  const load = async () => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    const { data, error } = await supabase
      .from("suivi_emotions")
      .select("*")
      .eq("joueur_id", userId)
      .gte("date", d.toISOString().split("T")[0])
      .order("date", { ascending: false });
    if (!error) setHistorique((data ?? []) as SuiviEmotionFull[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [userId]);

  // ── Reset formulaire ──
  const resetForm = () => {
    setEditingItem(null);
    setSelectedEmotions(new Set());
    setEntries({});
    setActiveEmotion(null);
    setDateS(new Date().toISOString().split("T")[0]);
    setSaveError(null);
  };

  // ── Mode édition ──
  const startEdit = (item: SuiviEmotionFull) => {
    const emotion = EMOTIONS.find((e) => e.nom === item.emotion_nom);
    if (!emotion) return;

    const savedDeclencheurs = item.declencheur ?? "";
    const matchedDecl = DECLENCHEURS_OPTIONS.filter((o) => savedDeclencheurs.includes(o.label)).map((o) => o.id);
    const unmatchedDecl = DECLENCHEURS_OPTIONS.reduce((acc, o) => acc.replace(o.label, ""), savedDeclencheurs).replace(/,\s*/g, "").trim();
    const hasAutreDecl = unmatchedDecl.length > 0;
    if (hasAutreDecl) matchedDecl.push("autre");

    const savedOutils = item.ressources ?? "";
    const matchedOutils = OUTILS_OPTIONS.filter((o) => savedOutils.includes(o.label)).map((o) => o.id);
    const unmatchedOutils = OUTILS_OPTIONS.reduce((acc, o) => acc.replace(o.label, ""), savedOutils).replace(/,\s*/g, "").trim();
    const hasAutreOutils = unmatchedOutils.length > 0;
    if (hasAutreOutils) matchedOutils.push("autre");

    const meta = item.metadata ?? {};
    const entry: EmotionEntry = {
      emotion,
      intensite: item.intensite,
      selectedDeclencheurs: matchedDecl,
      declencheurAutre: hasAutreDecl ? unmatchedDecl : "",
      selectedOutils: matchedOutils,
      outilsAutre: hasAutreOutils ? unmatchedOutils : "",
      expression: meta.expression ?? "neutral",
      pensees_type: meta.pensees_type ?? "calm",
    };

    setEditingItem(item);
    setDateS(item.date);
    setSelectedEmotions(new Set([item.emotion_nom]));
    setEntries({ [item.emotion_nom]: entry });
    setActiveEmotion(item.emotion_nom);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── Toggle émotion ──
  const toggleEmotion = (nom: string) => {
    if (editingItem) return;
    const emotion = EMOTIONS.find((e) => e.nom === nom)!;
    setSelectedEmotions((prev) => {
      const next = new Set(prev);
      if (next.has(nom)) { next.delete(nom); setActiveEmotion(null); }
      else {
        next.add(nom);
        if (!entries[nom]) setEntries((e) => ({
          ...e,
          [nom]: { emotion, intensite: 3, selectedDeclencheurs: [], declencheurAutre: "", selectedOutils: [], outilsAutre: "", expression: "neutral", pensees_type: "calm" },
        }));
        setActiveEmotion(nom);
      }
      return next;
    });
  };

  const toggleSelection = (emotionNom: string, field: "selectedDeclencheurs" | "selectedOutils", value: string) => {
    setEntries((prev) => {
      const current = prev[emotionNom][field] as string[];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [emotionNom]: { ...prev[emotionNom], [field]: next } };
    });
  };

  const updateEntry = (nom: string, field: keyof EmotionEntry, value: unknown) => {
    setEntries((prev) => ({ ...prev, [nom]: { ...prev[nom], [field]: value } }));
  };

  // ── Sauvegarde ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedEmotions.size === 0) return;
    setSaving(true);
    setSaveError(null);

    try {
      if (editingItem) {
        const nom = editingItem.emotion_nom;
        const payload = buildPayload(userId, dateS, nom, entries[nom]);
        const { error } = await supabase.from("suivi_emotions").update({
          date: payload.date,
          intensite: payload.intensite,
          declencheur: payload.declencheur,
          ressources: payload.ressources,
          metadata: payload.metadata,
        }).eq("id", editingItem.id);
        if (error) throw error;
      } else {
        const rows = Array.from(selectedEmotions).map((nom) => buildPayload(userId, dateS, nom, entries[nom]));
        const { error } = await supabase.from("suivi_emotions").insert(rows);
        if (error) throw error;
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      resetForm();
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? "Erreur inconnue";
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

  // ── Suppression ──
  const handleDelete = async (id: string) => {
    await supabase.from("suivi_emotions").delete().eq("id", id);
    setDeleteConfirm(null);
    if (editingItem?.id === id) resetForm();
    await load();
  };

  const historiqueParDate = historique.reduce<Record<string, SuiviEmotionFull[]>>((acc, item) => {
    (acc[item.date] = acc[item.date] ?? []).push(item);
    return acc;
  }, {});

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {!readOnly && (
        <Card>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-display text-2xl" style={{ color: "var(--accent)" }}>
              {editingItem ? "MODIFIER L'ÉMOTION" : "LE SCAN DE MES ÉMOTIONS"}
            </h2>
            {editingItem && (
              <button onClick={resetForm} className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                ✕ Annuler
              </button>
            )}
          </div>

          {editingItem && (
            <div className="rounded-lg px-4 py-2.5 mb-4 text-sm"
              style={{ background: "color-mix(in srgb, var(--accent) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)", color: "var(--text-sub)" }}>
              ✏️ Modification de <strong style={{ color: "var(--text-main)" }}>{editingItem.emotion_nom}</strong>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Date */}
            <input type="date" value={dateS} onChange={(e) => setDateS(e.target.value)}
              className="w-full px-4 py-3 rounded-xl outline-none"
              style={{ ...inputStyle, colorScheme: "dark" }} />

            {/* Grille émotions */}
            {!editingItem && (
              <div className="grid grid-cols-5 gap-2">
                {EMOTIONS.map((em) => {
                  const selected = selectedEmotions.has(em.nom);
                  const hasImgError = imgErrors.has(em.nom);
                  return (
                    <button key={em.nom} type="button" onClick={() => toggleEmotion(em.nom)}
                      className="flex flex-col items-center gap-1.5 p-1.5 rounded-xl transition-all duration-200"
                      style={{
                        border: selected ? `2px solid ${em.couleur}` : "2px solid var(--border)",
                        background: selected ? `color-mix(in srgb, ${em.couleur} 12%, var(--bg-card))` : "var(--bg-input)",
                        boxShadow: selected ? `0 0 14px color-mix(in srgb, ${em.couleur} 25%, transparent)` : "none",
                        position: "relative",
                      }}>
                      <div className="w-full aspect-square rounded-lg overflow-hidden"
                        style={{ background: `color-mix(in srgb, ${em.couleur} 10%, var(--bg-card))` }}>
                        {hasImgError ? (
                          <EmotionPlaceholder emoji={em.emoji} couleur={em.couleur} />
                        ) : (
                          <img src={`/emotions/${em.imagePath}`} alt={em.nom}
                            className="w-full h-full object-cover rounded-lg"
                            onError={() => setImgErrors((prev) => new Set(prev).add(em.nom))} />
                        )}
                      </div>
                      <span className="text-[10px] font-bold text-center uppercase leading-tight"
                        style={{ color: selected ? em.couleur : "var(--text-muted)" }}>
                        {em.nom}
                      </span>
                      {selected && (
                        <div className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
                          style={{ background: em.couleur, color: "white" }}>✓</div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Navigation multi-émotions */}
            {!editingItem && selectedEmotions.size > 1 && (
              <div className="flex flex-wrap gap-2">
                {Array.from(selectedEmotions).map((nom) => {
                  const em = EMOTIONS.find((e) => e.nom === nom)!;
                  return (
                    <button key={nom} type="button" onClick={() => setActiveEmotion(nom)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                      style={{
                        background: activeEmotion === nom ? `color-mix(in srgb, ${em.couleur} 15%, transparent)` : "var(--bg-input)",
                        border: `1px solid ${activeEmotion === nom ? em.couleur : "var(--border)"}`,
                        color: activeEmotion === nom ? em.couleur : "var(--text-muted)",
                      }}>
                      {em.emoji} {nom}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Détail émotion active */}
            {activeEmotion && entries[activeEmotion] && (() => {
              const em = EMOTIONS.find((e) => e.nom === activeEmotion)!;
              const entry = entries[activeEmotion];
              const hasImgError = imgErrors.has(activeEmotion);
              return (
                <div className="rounded-2xl p-4 space-y-6 animate-slide-in"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>

                  {/* En-tête émotion */}
                  <div className="flex items-center gap-3 pb-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0"
                      style={{ background: `color-mix(in srgb, ${em.couleur} 15%, var(--bg-card))` }}>
                      {hasImgError ? (
                        <EmotionPlaceholder emoji={em.emoji} couleur={em.couleur} />
                      ) : (
                        <img src={`/emotions/${em.imagePath}`} alt={activeEmotion}
                          className="w-full h-full object-cover"
                          onError={() => setImgErrors((prev) => new Set(prev).add(activeEmotion))} />
                      )}
                    </div>
                    <span className="font-display text-xl uppercase tracking-wider" style={{ color: em.couleur }}>
                      {activeEmotion}
                    </span>
                  </div>

                  {/* Intensité */}
                  <SliderField label="Intensité" subLabel="1 (Faible) → 5 (Maximum)"
                    value={entry.intensite} min={1} max={5}
                    onChange={(v) => updateEntry(activeEmotion, "intensite", v)} />

                  {/* Déclencheurs */}
                  <div>
                    <label style={labelStyle}>Déclencheurs</label>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      {DECLENCHEURS_OPTIONS.map((opt) => {
                        const isActive = entry.selectedDeclencheurs.includes(opt.id);
                        return (
                          <button key={opt.id} type="button"
                            onClick={() => toggleSelection(activeEmotion, "selectedDeclencheurs", opt.id)}
                            className="flex flex-col items-center p-2 rounded-xl border transition-all"
                            style={{
                              background: isActive ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "white",
                              border: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                              color: isActive ? "var(--accent)" : "#1e293b",
                            }}>
                            <img src={`/options/${opt.img}`} className="w-10 h-10 object-contain mb-1" alt=""
                              onError={(e) => { e.currentTarget.style.display = "none"; }} />
                            <span className="text-[9px] text-center leading-tight uppercase font-bold"
                              style={{ color: isActive ? "var(--accent)" : "#1e293b" }}>
                              {opt.label}
                            </span>
                          </button>
                        );
                      })}
                      <button type="button"
                        onClick={() => toggleSelection(activeEmotion, "selectedDeclencheurs", "autre")}
                        className="flex flex-col items-center justify-center p-2 rounded-xl border transition-all"
                        style={{
                          background: entry.selectedDeclencheurs.includes("autre") ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "var(--bg-input)",
                          border: entry.selectedDeclencheurs.includes("autre") ? "2px solid var(--accent)" : "1px solid var(--border)",
                          color: entry.selectedDeclencheurs.includes("autre") ? "var(--accent)" : "var(--text-muted)",
                        }}>
                        <span className="text-lg">➕</span>
                        <span className="text-[9px] uppercase font-bold">Autre</span>
                      </button>
                    </div>
                    {entry.selectedDeclencheurs.includes("autre") && (
                      <input type="text" placeholder="Précisez le déclencheur..."
                        value={entry.declencheurAutre}
                        onChange={(e) => updateEntry(activeEmotion, "declencheurAutre", e.target.value)}
                        className="w-full px-4 py-3 rounded-xl text-sm outline-none" style={inputStyle} />
                    )}
                  </div>

                  {/* Outils */}
                  <div>
                    <label style={labelStyle}>Mes Outils</label>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      {OUTILS_OPTIONS.map((opt) => {
                        const isActive = entry.selectedOutils.includes(opt.id);
                        return (
                          <button key={opt.id} type="button"
                            onClick={() => toggleSelection(activeEmotion, "selectedOutils", opt.id)}
                            className="flex flex-col items-center p-2 rounded-xl border transition-all"
                            style={{
                              background: isActive ? "color-mix(in srgb, #60A5FA 15%, transparent)" : "white",
                              border: isActive ? "2px solid #60A5FA" : "2px solid transparent",
                            }}>
                            <img src={`/options/${opt.img}`} className="w-10 h-10 object-contain mb-1" alt=""
                              onError={(e) => { e.currentTarget.style.display = "none"; }} />
                            <span className="text-[9px] text-center leading-tight uppercase font-bold"
                              style={{ color: isActive ? "#60A5FA" : "#1e293b" }}>
                              {opt.label}
                            </span>
                          </button>
                        );
                      })}
                      <button type="button"
                        onClick={() => toggleSelection(activeEmotion, "selectedOutils", "autre")}
                        className="flex flex-col items-center justify-center p-2 rounded-xl border transition-all"
                        style={{
                          background: entry.selectedOutils.includes("autre") ? "color-mix(in srgb, #60A5FA 15%, transparent)" : "var(--bg-input)",
                          border: entry.selectedOutils.includes("autre") ? "2px solid #60A5FA" : "1px solid var(--border)",
                          color: entry.selectedOutils.includes("autre") ? "#60A5FA" : "var(--text-muted)",
                        }}>
                        <span className="text-lg">➕</span>
                        <span className="text-[9px] uppercase font-bold">Autre</span>
                      </button>
                    </div>
                    {entry.selectedOutils.includes("autre") && (
                      <input type="text" placeholder="Autre outil utilisé..."
                        value={entry.outilsAutre}
                        onChange={(e) => updateEntry(activeEmotion, "outilsAutre", e.target.value)}
                        className="w-full px-4 py-3 rounded-xl text-sm outline-none" style={inputStyle} />
                    )}
                  </div>

                  {/* Expression & météo pensées */}
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label style={labelStyle}>Expression</label>
                      <div className="flex gap-3">
                        {EXPRESSIONS.map((exp) => (
                          <button key={exp.val} type="button"
                            onClick={() => updateEntry(activeEmotion, "expression", exp.val)}
                            className="text-2xl p-2 rounded-lg transition-all"
                            style={{
                              background: entry.expression === exp.val ? "color-mix(in srgb, var(--accent) 20%, transparent)" : "rgba(255,255,255,0.05)",
                              outline: entry.expression === exp.val ? "2px solid var(--accent)" : "none",
                              opacity: entry.expression === exp.val ? 1 : 0.4,
                            }}>
                            {exp.icon}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label style={labelStyle}>Météo Pensées</label>
                      <div className="flex gap-3">
                        {PENSEES_TYPES.map((pt) => (
                          <button key={pt.val} type="button"
                            onClick={() => updateEntry(activeEmotion, "pensees_type", pt.val)}
                            className="text-2xl p-2 rounded-lg transition-all"
                            title={pt.label}
                            style={{
                              background: entry.pensees_type === pt.val ? "rgba(96,165,250,0.2)" : "rgba(255,255,255,0.05)",
                              outline: entry.pensees_type === pt.val ? "2px solid #60A5FA" : "none",
                              opacity: entry.pensees_type === pt.val ? 1 : 0.4,
                            }}>
                            {pt.icon}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Messages */}
            {saveError && (
              <div className="rounded-lg px-4 py-3 text-sm"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}>
                ❌ Erreur : {saveError}
              </div>
            )}
            {saved && (
              <div className="rounded-lg px-4 py-3 text-sm animate-slide-in"
                style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", color: "#86efac" }}>
                {editingItem ? "✅ Émotion modifiée !" : "✅ Émotions enregistrées !"}
              </div>
            )}

            <button type="submit" disabled={saving || selectedEmotions.size === 0}
              className="w-full py-4 rounded-xl font-display text-lg tracking-widest transition-all disabled:opacity-30"
              style={{ background: "linear-gradient(135deg, var(--accent), var(--accent2))", color: "white", boxShadow: "0 4px 20px var(--accent-glow)" }}>
              {saving ? "ENREGISTREMENT..." : editingItem ? "MODIFIER" : "VALIDER LE SCAN"}
            </button>
          </form>
        </Card>
      )}

      {/* ── Historique ── */}
      <div>
        <h3 className="font-display text-xl mb-4" style={{ color: "var(--text-main)" }}>
          HISTORIQUE (30 DERNIERS JOURS)
        </h3>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
          </div>
        ) : Object.keys(historiqueParDate).length === 0 ? (
          <Card>
            <p className="text-center py-4" style={{ color: "var(--text-muted)" }}>
              Aucune émotion ces 30 derniers jours.
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {Object.entries(historiqueParDate).map(([date, items], i) => (
              <div key={date} className="animate-fade-in-up"
                style={{ animationDelay: `${i * 0.05}s`, opacity: 0, animationFillMode: "forwards" }}>
                <p className="text-xs font-medium tracking-widest uppercase mb-2" style={{ color: "var(--text-sub)" }}>
                  {new Date(date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                </p>
                <div className="space-y-2">
                  {items.map((item) => {
                    const em = EMOTIONS.find((e) => e.nom === item.emotion_nom);
                    const meta = item.metadata ?? {};
                    const expression = EXPRESSIONS.find((e) => e.val === meta.expression);
                    const pensees = PENSEES_TYPES.find((p) => p.val === meta.pensees_type);
                    return (
                      <Card key={item.id}>
                        <div style={editingItem?.id === item.id ? { outline: "2px solid var(--accent)", outlineOffset: "3px", borderRadius: "8px" } : {}}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-base">{em?.emoji ?? "💭"}</span>
                                <span className="font-medium text-sm" style={{ color: em?.couleur ?? "var(--accent)" }}>
                                  {item.emotion_nom}
                                </span>
                                <span className="font-display text-sm px-2 py-0.5 rounded"
                                  style={{ background: `color-mix(in srgb, ${em?.couleur ?? "var(--accent)"} 12%, transparent)`, color: em?.couleur ?? "var(--accent)" }}>
                                  {item.intensite}/5
                                </span>
                                {expression && <span title="Expression">{expression.icon}</span>}
                                {pensees && <span title={`Pensées : ${pensees.label}`}>{pensees.icon}</span>}
                              </div>
                              {item.declencheur && (
                                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                                  <span style={{ color: "var(--text-sub)" }}>Déclencheur :</span> {item.declencheur}
                                </p>
                              )}
                              {item.ressources && (
                                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                                  <span style={{ color: "var(--text-sub)" }}>Outils :</span> {item.ressources}
                                </p>
                              )}
                            </div>
                            {!readOnly && (
                              <div className="flex gap-1.5 shrink-0">
                                {deleteConfirm === item.id ? (
                                  <>
                                    <button onClick={() => handleDelete(item.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium"
                                      style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}>
                                      Confirmer
                                    </button>
                                    <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium"
                                      style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                                      Annuler
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <IconBtn onClick={() => startEdit(item)} title="Modifier" icon="✏️" />
                                    <IconBtn onClick={() => setDeleteConfirm(item.id)} title="Supprimer" icon="🗑" danger />
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}