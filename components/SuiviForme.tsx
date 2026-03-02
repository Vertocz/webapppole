"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { SuiviForme as SuiviFormeType } from "@/types";
import Card from "./Card";
import GraphiqueForme from "./GraphiqueForme";
import SliderField from "./SliderField";

const LABELS = {
  fatigue: { icon: "😴", label: "Fatigue générale",   sub: "😊 Très frais → 🫩 Toujours fatigué" },
  sommeil: { icon: "🛌", label: "Qualité du sommeil", sub: "👀 Insomnie → 💤 Très reposant" },
  douleur: { icon: "🤕", label: "Douleurs",           sub: "😎 Aucune → 😖 Très douloureuse" },
  stress:  { icon: "😰", label: "Niveau de stress",   sub: "🧘‍♀️ Très détendu → 😧 Très stressé" },
  humeur:  { icon: "😊", label: "Humeur générale",    sub: "😡 Irritable → 🥳 Très positif" },
};

const inputStyle = { background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)" } as React.CSSProperties;
const labelStyle = { display: "block", fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "var(--text-sub)", marginBottom: "0.5rem" };

export default function SuiviForme({ userId, readOnly = false }: { userId: string; readOnly?: boolean }) {
  const [data, setData] = useState<SuiviFormeType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [dateS, setDateS] = useState(new Date().toISOString().split("T")[0]);
  const [fatigue, setFatigue] = useState(3);
  const [sommeil, setSommeil] = useState(3);
  const [douleur, setDouleur] = useState(3);
  const [stress, setStress] = useState(3);
  const [humeur, setHumeur] = useState(3);
  const [commentaire, setCommentaire] = useState("");

  const load = async () => {
    const d = new Date(); d.setDate(d.getDate() - 60);
    const { data: d2 } = await supabase.from("suivi_forme").select("*").eq("joueuse_id", userId)
      .gte("date", d.toISOString().split("T")[0]).order("date", { ascending: false });
    setData(d2 ?? []); setLoading(false);
  };

  useEffect(() => { load(); }, [userId]);

  const resetForm = () => {
    setEditingId(null); setDateS(new Date().toISOString().split("T")[0]);
    setFatigue(3); setSommeil(3); setDouleur(3); setStress(3); setHumeur(3); setCommentaire("");
  };

  const startEdit = (d: SuiviFormeType) => {
    setEditingId(d.id); setDateS(d.date);
    setFatigue(d.fatigue); setSommeil(d.sommeil); setDouleur(d.douleur);
    setStress(d.stress); setHumeur(d.humeur); setCommentaire(d.commentaire ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const payload = { date: dateS, fatigue, sommeil, douleur, stress, humeur, commentaire };
    if (editingId) {
      await supabase.from("suivi_forme").update(payload).eq("id", editingId);
    } else {
      await supabase.from("suivi_forme").insert({ joueuse_id: userId, ...payload });
    }
    setSaved(true); setTimeout(() => setSaved(false), 3000);
    resetForm(); await load(); setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("suivi_forme").delete().eq("id", id);
    setDeleteConfirm(null); if (editingId === id) resetForm(); await load();
  };

  return (
    <div className="space-y-6">
      {!readOnly && (
        <Card>
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display text-2xl court-line pb-3" style={{ color: "var(--text-main)" }}>
              {editingId ? "MODIFIER LE SUIVI" : "SUIVI DU JOUR"}
            </h2>
            {editingId && (
              <button onClick={resetForm} className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-main)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
                ✕ Annuler
              </button>
            )}
          </div>
          {editingId && (
            <div className="rounded-lg px-4 py-2.5 mb-4 text-sm"
              style={{ background: "color-mix(in srgb, var(--accent) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)", color: "var(--text-sub)" }}>
              ✏️ Mode modification — les changements remplaceront l&apos;entrée existante.
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label style={labelStyle}>Date</label>
              <input type="date" value={dateS} onChange={(e) => setDateS(e.target.value)}
                className="w-full px-4 py-3 rounded-xl outline-none" style={{ ...inputStyle, colorScheme: "dark" }} />
            </div>
            <SliderField label="😴 Fatigue générale"   subLabel={LABELS.fatigue.sub} value={fatigue} min={1} max={5} onChange={setFatigue} />
            <SliderField label="🛌 Qualité du sommeil" subLabel={LABELS.sommeil.sub} value={sommeil} min={1} max={5} onChange={setSommeil} />
            <SliderField label="🤕 Douleurs"           subLabel={LABELS.douleur.sub} value={douleur} min={1} max={5} onChange={setDouleur} />
            <SliderField label="😰 Niveau de stress"   subLabel={LABELS.stress.sub}  value={stress}  min={1} max={5} onChange={setStress} />
            <SliderField label="😊 Humeur générale"    subLabel={LABELS.humeur.sub}  value={humeur}  min={1} max={5} onChange={setHumeur} />
            <div>
              <label style={labelStyle}>Commentaire (optionnel)</label>
              <textarea value={commentaire} onChange={(e) => setCommentaire(e.target.value)} rows={3}
                placeholder="Ressenti du jour..." className="w-full px-4 py-3 rounded-xl outline-none resize-none" style={inputStyle} />
            </div>
            {saved && (
              <div className="rounded-lg px-4 py-3 text-sm animate-slide-in" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", color: "#86efac" }}>
                {editingId ? "✅ Suivi modifié !" : "✅ Suivi enregistré !"}
              </div>
            )}
            <button type="submit" disabled={saving}
              className="w-full py-3.5 rounded-xl font-display text-lg tracking-widest transition-all disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, var(--accent), var(--accent2))", color: "white", boxShadow: "0 4px 20px var(--accent-glow)" }}>
              {saving ? "Enregistrement..." : editingId ? "MODIFIER" : "ENREGISTRER"}
            </button>
          </form>
        </Card>
      )}

      <GraphiqueForme data={data} />

      <div>
        <h3 className="font-display text-xl mb-4" style={{ color: "var(--text-main)" }}>
          {readOnly ? "FORME (30 DERNIERS JOURS)" : "HISTORIQUE (30 DERNIERS JOURS)"}
        </h3>
        {loading ? (
          <div className="flex justify-center py-8"><div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} /></div>
        ) : data.length === 0 ? (
          <Card><p className="text-center py-4" style={{ color: "var(--text-muted)" }}>Aucune donnée ces 30 derniers jours.</p></Card>
        ) : (
          <div className="space-y-3">
            {data.map((d, i) => (
              <div key={d.id} className="animate-fade-in-up" style={{ animationDelay: `${i * 0.05}s`, opacity: 0, animationFillMode: "forwards" }}>
                <Card>
                  <div style={editingId === d.id ? { outline: "2px solid var(--accent)", outlineOffset: "3px", borderRadius: "8px" } : {}}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--text-sub)" }}>
                          {new Date(d.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                        </p>
                        <div className="grid grid-cols-5 gap-2 mb-2">
                          {Object.entries(LABELS).map(([key, meta]) => (
                            <div key={key} className="text-center">
                              <div className="text-lg">{meta.icon}</div>
                              <div className="font-display text-lg leading-none" style={{ color: "var(--accent)" }}>
                                {d[key as keyof typeof LABELS]}
                              </div>
                              <div className="text-[9px] mt-0.5 capitalize" style={{ color: "var(--text-muted)" }}>{key}</div>
                            </div>
                          ))}
                        </div>
                        {d.commentaire && <p className="text-xs italic mt-2" style={{ color: "var(--text-muted)" }}>&ldquo;{d.commentaire}&rdquo;</p>}
                      </div>
                      {!readOnly && (
                        <div className="flex gap-1.5 shrink-0">
                          {deleteConfirm === d.id ? (
                            <>
                              <button onClick={() => handleDelete(d.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}>Confirmer</button>
                              <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>Annuler</button>
                            </>
                          ) : (
                            <>
                              <IconBtn onClick={() => startEdit(d)} title="Modifier" icon="✏️" />
                              <IconBtn onClick={() => setDeleteConfirm(d.id)} title="Supprimer" icon="🗑" danger />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
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
