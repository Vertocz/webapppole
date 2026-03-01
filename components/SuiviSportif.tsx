"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Activite } from "@/types";
import Card from "./Card";
import SliderField from "./SliderField";

const SPORTS = [
  "⛹️‍♀️ Basket", "🚴‍♂️ Vélo", "🏃‍♂️ Course à pied", "🏓 Tennis de table",
  "🏸 Badminton", "🏊‍♂️ Natation", "🏋️‍♂️ Renforcement musculaire", "⚽ Football", "Autre",
];

const inputStyle = { background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)" } as React.CSSProperties;
const labelStyle = { display: "block", fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "var(--text-sub)", marginBottom: "0.5rem" };

export default function SuiviSportif({ userId, readOnly = false }: { userId: string; readOnly?: boolean }) {
  const [activites, setActivites] = useState<Activite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [sport, setSport] = useState(SPORTS[0]);
  const [duree, setDuree] = useState("");
  const [difficulte, setDifficulte] = useState(5);
  const [plaisir, setPlaisir] = useState(5);
  const [dateActivite, setDateActivite] = useState(new Date().toISOString().split("T")[0]);
  const [commentaire, setCommentaire] = useState("");

  const load = async () => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    const { data } = await supabase.from("activites").select("*").eq("joueuse_id", userId)
      .gte("date", d.toISOString().split("T")[0]).order("date", { ascending: false });
    setActivites(data ?? []); setLoading(false);
  };

  useEffect(() => { load(); }, [userId]);

  const resetForm = () => {
    setEditingId(null); setSport(SPORTS[0]); setDuree(""); setDifficulte(5); setPlaisir(5);
    setDateActivite(new Date().toISOString().split("T")[0]); setCommentaire("");
  };

  const startEdit = (a: Activite) => {
    setEditingId(a.id); setSport(a.sport); setDuree(a.duree);
    setDifficulte(a.difficulte); setPlaisir(a.plaisir);
    setDateActivite(a.date); setCommentaire(a.commentaire ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const payload = { sport, duree, difficulte, plaisir, commentaire, date: dateActivite };
    if (editingId) {
      await supabase.from("activites").update(payload).eq("id", editingId);
    } else {
      await supabase.from("activites").insert({ joueuse_id: userId, ...payload });
    }
    setSaved(true); setTimeout(() => setSaved(false), 3000);
    resetForm(); await load(); setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("activites").delete().eq("id", id);
    setDeleteConfirm(null); if (editingId === id) resetForm(); await load();
  };

  return (
    <div className="space-y-6">
      {!readOnly && (
        <Card>
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display text-2xl court-line pb-3" style={{ color: "var(--text-main)" }}>
              {editingId ? "MODIFIER LA SÉANCE" : "NOUVELLE SÉANCE"}
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
              <label style={labelStyle}>Sport pratiqué</label>
              <select value={sport} onChange={(e) => setSport(e.target.value)}
                className="w-full px-4 py-3 rounded-xl outline-none" style={{ ...inputStyle, colorScheme: "dark" }}>
                {SPORTS.map((s) => <option key={s} value={s} style={{ background: "var(--bg-card)" }}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Durée</label>
              <input type="text" value={duree} onChange={(e) => setDuree(e.target.value)} placeholder="Ex: 1h30"
                className="w-full px-4 py-3 rounded-xl outline-none" style={inputStyle} />
            </div>
            <SliderField label="💪 Difficulté ressentie" subLabel="😁 Facile → 🥵 Très difficile" value={difficulte} min={1} max={10} onChange={setDifficulte} />
            <SliderField label="😄 Plaisir pris" subLabel="😡 Aucun → 🥰 Énorme" value={plaisir} min={1} max={10} onChange={setPlaisir} />
            <div>
              <label style={labelStyle}>Date</label>
              <input type="date" value={dateActivite} onChange={(e) => setDateActivite(e.target.value)}
                className="w-full px-4 py-3 rounded-xl outline-none" style={{ ...inputStyle, colorScheme: "dark" }} />
            </div>
            <div>
              <label style={labelStyle}>Commentaire (optionnel)</label>
              <textarea value={commentaire} onChange={(e) => setCommentaire(e.target.value)} rows={3}
                placeholder="Observations, ressenti..." className="w-full px-4 py-3 rounded-xl outline-none resize-none" style={inputStyle} />
            </div>
            {saved && <SuccessBanner text={editingId ? "✅ Séance modifiée !" : "✅ Activité enregistrée !"} />}
            <button type="submit" disabled={saving || !duree}
              className="w-full py-3.5 rounded-xl font-display text-lg tracking-widest transition-all disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, var(--accent), var(--accent2))", color: "white", boxShadow: "0 4px 20px var(--accent-glow)" }}>
              {saving ? "Enregistrement..." : editingId ? "MODIFIER" : "ENREGISTRER"}
            </button>
          </form>
        </Card>
      )}

      <div>
        <h3 className="font-display text-xl mb-4" style={{ color: "var(--text-main)" }}>
          {readOnly ? "SÉANCES (30 DERNIERS JOURS)" : "HISTORIQUE (30 DERNIERS JOURS)"}
        </h3>
        {loading ? <Spinner /> : activites.length === 0 ? (
          <Card><p className="text-center py-4" style={{ color: "var(--text-muted)" }}>Aucune séance ces 30 derniers jours.</p></Card>
        ) : (
          <div className="space-y-3">
            {activites.map((a, i) => (
              <div key={a.id} className="animate-fade-in-up" style={{ animationDelay: `${i * 0.05}s`, opacity: 0, animationFillMode: "forwards" }}>
                <Card>
                  <div
                    className="rounded-xl transition-all"
                    style={editingId === a.id ? { outline: "2px solid var(--accent)", outlineOffset: "3px" } : {}}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-sub)" }}>
                            {new Date(a.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                          </span>
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>·</span>
                          <span className="text-sm font-medium" style={{ color: "var(--text-main)" }}>{a.sport}</span>
                        </div>
                        <div className="flex flex-wrap gap-3 text-sm">
                          <span style={{ color: "var(--text-muted)" }}>⏱ {a.duree}</span>
                          <span style={{ color: "#F87171" }}>💪 {a.difficulte}/10</span>
                          <span style={{ color: "#86efac" }}>😄 {a.plaisir}/10</span>
                        </div>
                        {a.commentaire && <p className="text-xs mt-2 italic" style={{ color: "var(--text-muted)" }}>&ldquo;{a.commentaire}&rdquo;</p>}
                      </div>
                      {!readOnly && (
                        <div className="flex gap-1.5 shrink-0">
                          {deleteConfirm === a.id ? (
                            <>
                              <button onClick={() => handleDelete(a.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}>Confirmer</button>
                              <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>Annuler</button>
                            </>
                          ) : (
                            <>
                              <IconBtn onClick={() => startEdit(a)} title="Modifier" icon="✏️" />
                              <IconBtn onClick={() => setDeleteConfirm(a.id)} title="Supprimer" icon="🗑" danger />
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

function Spinner() {
  return <div className="flex justify-center py-8"><div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} /></div>;
}
function SuccessBanner({ text }: { text: string }) {
  return <div className="rounded-lg px-4 py-3 text-sm animate-slide-in" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", color: "#86efac" }}>{text}</div>;
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
