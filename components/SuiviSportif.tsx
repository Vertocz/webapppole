"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Activite } from "@/types";
import Card from "./Card";
import GraphiqueSportif from "./GraphiqueSportif";
import SliderField from "./SliderField";
import { todayISO, toLocalISODate } from "@/lib/dates";
import { applyPending, useOnSync, writeOrQueue } from "@/lib/offline";
import { PendingTag, QueuedBanner } from "./OfflineUI";
import { IconBtn, RANGES, RangeSwitch, Spinner, SuccessBanner, fieldInputStyle as inputStyle, fieldLabelStyle as labelStyle } from "./ui";

type ActiviteAffichee = Activite & { _pending?: boolean };

const SPORTS = [
  "⛹️‍♀️ Basket", "🚴‍♂️ Vélo", "🏃‍♂️ Course à pied", "🏓 Tennis de table",
  "🏸 Badminton", "🏊‍♂️ Natation", "🏋️‍♂️ Renforcement musculaire", "⚽ Football", "Autre",
];

export default function SuiviSportif({ userId, readOnly = false, onSave, onCreate }: { userId: string; readOnly?: boolean; onSave?: () => void; onCreate?: () => void }) {
  const [activites, setActivites] = useState<ActiviteAffichee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<false | "ok" | "queued">(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [plage, setPlage] = useState<string>("30");

  const [sport, setSport] = useState(SPORTS[0]);
  const [duree, setDuree] = useState("");
  const [difficulte, setDifficulte] = useState(5);
  const [plaisir, setPlaisir] = useState(5);
  const [dateActivite, setDateActivite] = useState(todayISO());
  const [commentaire, setCommentaire] = useState("");

  const range = RANGES.find((r) => r.val === plage) ?? RANGES[0];

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("activites").select("*").eq("joueuse_id", userId).order("date", { ascending: false });
    if (range.jours !== null) {
      const d = new Date(); d.setDate(d.getDate() - range.jours);
      query = query.gte("date", toLocalISODate(d));
    }
    const { data } = await query;
    const rows: ActiviteAffichee[] = readOnly
      ? (data ?? [])
      : (await applyPending(data ?? [], "activites", "joueuse_id", userId))
          .sort((a, b) => b.date.localeCompare(a.date));
    setActivites(rows);
    setLoading(false);
  }, [userId, plage, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  useOnSync(["activites"], load);

  const resetForm = () => {
    setEditingId(null); setSport(SPORTS[0]); setDuree(""); setDifficulte(5); setPlaisir(5);
    setDateActivite(todayISO()); setCommentaire("");
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
    const res = editingId
      ? await writeOrQueue("activites", "update", { payload, rowId: editingId })
      : await writeOrQueue("activites", "insert", { payload: { joueuse_id: userId, ...payload }, reward: userId });
    if (!editingId && !res.queued && !res.error) onCreate?.();
    setSaved(res.queued ? "queued" : "ok");
    setTimeout(() => setSaved(false), res.queued ? 5000 : 3000);
    if (!res.queued) onSave?.();
    resetForm(); await load(); setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await writeOrQueue("activites", "delete", { rowId: id });
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
              <button onClick={resetForm} className="hover-text-main px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
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
            {saved === "ok" && <SuccessBanner text={editingId ? "✅ Séance modifiée !" : "✅ Activité enregistrée !"} />}
            {saved === "queued" && <QueuedBanner />}
            <button type="submit" disabled={saving || !duree}
              className="w-full py-3.5 rounded-xl font-display text-lg tracking-widest transition-all disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, var(--accent), var(--accent2))", color: "white", boxShadow: "0 4px 20px var(--accent-glow)" }}>
              {saving ? "Enregistrement..." : editingId ? "MODIFIER" : "ENREGISTRER"}
            </button>
          </form>
        </Card>
      )}

      <GraphiqueSportif activites={activites} />

      <div>
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h3 className="font-display text-xl" style={{ color: "var(--text-main)" }}>
            {readOnly ? `SÉANCES (${range.label.toUpperCase()})` : `HISTORIQUE (${range.label.toUpperCase()})`}
          </h3>
          <RangeSwitch value={plage} onChange={setPlage} />
        </div>
        {loading ? <Spinner /> : activites.length === 0 ? (
          <Card><p className="text-center py-4" style={{ color: "var(--text-muted)" }}>Aucune séance sur cette période.</p></Card>
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
                            {new Date(a.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>·</span>
                          <span className="text-sm font-medium" style={{ color: "var(--text-main)" }}>{a.sport}</span>
                          {a._pending && <PendingTag />}
                        </div>
                        <div className="flex flex-wrap gap-3 text-sm">
                          <span style={{ color: "var(--text-muted)" }}>⏱ {a.duree}</span>
                          <span style={{ color: "#F87171" }}>💪 {a.difficulte}/10</span>
                          <span style={{ color: "#86efac" }}>😄 {a.plaisir}/10</span>
                        </div>
                        {a.commentaire && <p className="text-xs mt-2 italic" style={{ color: "var(--text-main)" }}>&ldquo;{a.commentaire}&rdquo;</p>}
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
