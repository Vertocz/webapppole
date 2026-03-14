"use client";

/**
 * BadgeManager.tsx
 *
 * Gestion des badges dans l'interface admin :
 *  - Liste de tous les badges existants
 *  - Formulaire d'ajout d'un badge manuel
 *
 * ⚠️  Tous les sous-composants (AddBadgeForm) sont définis EN DEHORS
 *     de BadgeManager pour éviter le bug React où l'input perd le focus
 *     à chaque frappe (React recrée le composant si défini inline).
 */

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────
interface BadgeRow {
  id: string;
  nom: string;
  description: string;
  type: "automatique" | "manuel";
  masculin: boolean;
  feminin: boolean;
  joueurs: boolean;
  staff: boolean;
  image_url_masc: string | null;
  image_url_fem:  string | null;
}

interface FormData {
  id:            string;
  nom:           string;
  description:   string;
  masculin:      boolean;
  feminin:       boolean;
  joueurs:       boolean;
  staff:         boolean;
  image_url_masc: string;
  image_url_fem:  string;
}

const EMPTY_FORM: FormData = {
  id:             "",
  nom:            "",
  description:    "",
  masculin:       true,
  feminin:        true,
  joueurs:        true,
  staff:          false,
  image_url_masc: "",
  image_url_fem:  "",
};

// ─── Sous-composant formulaire (défini HORS du parent) ────────────────────────
interface AddBadgeFormProps {
  form:      FormData;
  saving:    boolean;
  onChange:  (field: keyof FormData, value: string | boolean) => void;
  onSubmit:  () => void;
  onCancel:  () => void;
}

function AddBadgeForm({ form, saving, onChange, onSubmit, onCancel }: AddBadgeFormProps) {
  const inputStyle: React.CSSProperties = {
    background:   "var(--bg-input)",
    border:       "1px solid var(--border)",
    color:        "var(--text-main)",
    borderRadius: "0.5rem",
    padding:      "0.5rem 0.75rem",
    fontSize:     "0.8125rem",
    width:        "100%",
    outline:      "none",
  };

  const isValid = form.nom.trim().length > 0 && form.id.trim().length > 0;

  return (
    <div
      className="rounded-xl p-5 space-y-4"
      style={{
        background: "var(--bg-card)",
        border:     "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
      }}
    >
      <p className="text-xs uppercase tracking-widest font-medium" style={{ color: "var(--accent)" }}>
        Nouveau badge manuel
      </p>

      {/* ID + Nom */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            ID (unique) *
          </label>
          <input
            value={form.id}
            placeholder="ex: mvp_semaine"
            onChange={e => onChange("id", e.target.value.toLowerCase().replace(/\s/g, "_"))}
            style={inputStyle}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Nom affiché *
          </label>
          <input
            value={form.nom}
            placeholder="MVP de la semaine"
            onChange={e => onChange("nom", e.target.value)}
            style={inputStyle}
          />
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1">
        <label className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          Description
        </label>
        <textarea
          value={form.description}
          placeholder="Condition ou raison d'attribution…"
          rows={2}
          onChange={e => onChange("description", e.target.value)}
          style={{ ...inputStyle, resize: "none" }}
        />
      </div>

      {/* URLs images */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Image (masc / neutre)
          </label>
          <input
            value={form.image_url_masc}
            placeholder="/badges/mon_badge.png"
            onChange={e => onChange("image_url_masc", e.target.value)}
            style={inputStyle}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Image (féminin)
          </label>
          <input
            value={form.image_url_fem}
            placeholder="/badges/mon_badge_fem.png"
            onChange={e => onChange("image_url_fem", e.target.value)}
            style={inputStyle}
          />
        </div>
      </div>

      {/* Checkboxes cibles */}
      <div className="space-y-1">
        <label className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          Visible par
        </label>
        <div className="flex flex-wrap gap-3">
          {(["masculin", "feminin", "joueurs", "staff"] as const).map(field => (
            <label key={field} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form[field] as boolean}
                onChange={e => onChange(field, e.target.checked)}
                className="w-4 h-4 rounded accent-orange-500"
              />
              <span className="text-sm capitalize" style={{ color: "var(--text-main)" }}>
                {field === "masculin" ? "Masc" : field === "feminin" ? "Fém" : field === "joueurs" ? "Joueurs" : "Staff"}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Boutons */}
      <div className="flex gap-3 pt-1">
        <button
          onClick={onSubmit}
          disabled={saving || !isValid}
          className="flex-1 py-3 rounded-xl font-display text-sm tracking-widest transition-all disabled:opacity-40"
          style={{
            background: "linear-gradient(135deg, var(--accent), var(--accent2))",
            color:      "white",
          }}
        >
          {saving ? "Enregistrement…" : "ENREGISTRER"}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-3 rounded-xl text-sm font-medium"
          style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function BadgeManager() {
  const [badges,  setBadges]  = useState<BadgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding,  setAdding]  = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [form,    setForm]    = useState<FormData>(EMPTY_FORM);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const loadBadges = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("badges").select("*").order("type").order("nom");
    setBadges(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { loadBadges(); }, [loadBadges]);

  const showFeedback = (type: "success" | "error", msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 3500);
  };

  // ── Changement de champ (stable, ne recrée pas le composant) ─────────────
  const handleChange = useCallback((field: keyof FormData, value: string | boolean) => {
    setForm(prev => ({ ...prev, [field]: value }));
  }, []);

  // ── Annuler ───────────────────────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    setAdding(false);
    setForm(EMPTY_FORM);
  }, []);

  // ── Soumettre ─────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!form.nom.trim() || !form.id.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("badges").insert({
      id:             form.id.trim(),
      nom:            form.nom.trim(),
      description:    form.description.trim(),
      type:           "manuel",
      masculin:       form.masculin,
      feminin:        form.feminin,
      joueurs:        form.joueurs,
      staff:          form.staff,
      image_url_masc: form.image_url_masc.trim() || null,
      image_url_fem:  form.image_url_fem.trim()  || null,
    });
    setSaving(false);
    if (error) {
      showFeedback("error", error.code === "23505"
        ? `L'id "${form.id}" existe déjà.`
        : "Erreur : " + error.message);
      return;
    }
    showFeedback("success", `Badge "${form.nom}" créé !`);
    setAdding(false);
    setForm(EMPTY_FORM);
    loadBadges();
  }, [form, loadBadges]);

  // ── Supprimer un badge manuel ─────────────────────────────────────────────
  const handleDelete = useCallback(async (badge: BadgeRow) => {
    if (!confirm(`Supprimer le badge "${badge.nom}" ? Cette action est irréversible.`)) return;
    const { error } = await supabase.from("badges").delete().eq("id", badge.id);
    if (error) { showFeedback("error", "Erreur : " + error.message); return; }
    showFeedback("success", "Badge supprimé.");
    loadBadges();
  }, [loadBadges]);

  // ─── Rendu ─────────────────────────────────────────────────────────────────
  const manualBadges = badges.filter(b => b.type === "manuel");
  const autoBadges   = badges.filter(b => b.type === "automatique");

  return (
    <div className="space-y-4">

      {/* Feedback */}
      {feedback && (
        <div className="rounded-xl px-4 py-3 text-sm font-medium"
          style={{
            background: feedback.type === "success" ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
            border:     `1px solid ${feedback.type === "success" ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)"}`,
            color:      feedback.type === "success" ? "#4ade80" : "#f87171",
          }}>
          {feedback.msg}
        </div>
      )}

      {/* En-tête + bouton ajouter */}
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-widest font-medium" style={{ color: "var(--text-sub)" }}>
          {badges.length} badge{badges.length > 1 ? "s" : ""} au total
        </p>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-95"
            style={{
              background: "linear-gradient(135deg, var(--accent), var(--accent2))",
              color:      "white",
              boxShadow:  "0 2px 8px var(--accent-glow)",
            }}
          >
            <span>+</span><span>Nouveau badge</span>
          </button>
        )}
      </div>

      {/* Formulaire d'ajout */}
      {adding && (
        <AddBadgeForm
          form={form}
          saving={saving}
          onChange={handleChange}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
        </div>
      ) : (
        <>
          {/* Badges manuels */}
          {manualBadges.length > 0 && (
            <Section
              title="Badges manuels"
              icon="🏅"
              badges={manualBadges}
              canDelete
              onDelete={handleDelete}
            />
          )}

          {/* Badges automatiques (lecture seule) */}
          {autoBadges.length > 0 && (
            <Section
              title="Badges automatiques"
              icon="⚙️"
              badges={autoBadges}
              canDelete={false}
              onDelete={handleDelete}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Section liste (défini HORS du parent) ────────────────────────────────────
interface SectionProps {
  title:     string;
  icon:      string;
  badges:    BadgeRow[];
  canDelete: boolean;
  onDelete:  (b: BadgeRow) => void;
}

function Section({ title, icon, badges, canDelete, onDelete }: SectionProps) {
  return (
    <div>
      <p className="text-xs uppercase tracking-widest font-medium mb-2 flex items-center gap-2"
        style={{ color: "var(--text-sub)" }}>
        <span>{icon}</span>{title}
      </p>
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        {badges.map((b, i) => (
          <div
            key={b.id}
            className="flex items-center gap-3 px-4 py-3"
            style={{
              background:   "var(--bg-card)",
              borderBottom: i < badges.length - 1 ? "1px solid var(--border)" : "none",
            }}
          >
            {/* Image preview */}
            {(() => {
              const src = b.image_url_masc ?? b.image_url_fem ?? null;
              return src
                ? <Image src={src} alt={b.nom} width={36} height={36} className="object-contain flex-shrink-0" />
                : <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: "var(--bg-input)" }}><span className="text-lg">🏅</span></div>;
            })()}

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-bold" style={{ color: "var(--text-main)" }}>{b.nom}</p>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}>
                  {b.id}
                </span>
              </div>
              {b.description && (
                <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {b.description}
                </p>
              )}
              <div className="flex gap-1 mt-1 flex-wrap">
                {b.masculin && <Pill>Masc</Pill>}
                {b.feminin  && <Pill>Fém</Pill>}
                {b.joueurs  && <Pill>Joueurs</Pill>}
                {b.staff    && <Pill>Staff</Pill>}
              </div>
            </div>

            {/* Supprimer (badges manuels seulement) */}
            {canDelete && (
              <button
                onClick={() => onDelete(b)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all hover:opacity-80 flex-shrink-0"
                style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}
                title="Supprimer"
              >
                🗑️
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded-full"
      style={{ background: "rgba(100,160,255,0.12)", color: "#64A0FF" }}>
      {children}
    </span>
  );
}