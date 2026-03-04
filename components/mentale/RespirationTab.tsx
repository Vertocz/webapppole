"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { SuiviRespiration } from "@/types";
import Card from "../Card";

// ─── Structure des exercices ──────────────────────────────────────────────────
const CATEGORIES = [
  {
    id: "activation",
    titre: "Activation",
    icone: "⚡",
    couleur: "#F87171",
    description: "Prépare le corps et l'esprit avant un effort.",
    criteres: {
      temps: ["15 sec", "30 sec", "45 sec"],
      moment: ["Dans les vestiaires", "À l'échauffement", "Pendant le match"],
    },
    exercices: [
      {
        id: "lapin",
        titre: "Exercice du lapin",
        description: "Inspirations rapides et courtes par le nez, comme un lapin. Booste l'énergie et la concentration avant un match.",
        instruction: "🐰 Inspire et expire très rapidement par le nez, comme un lapin. Répète sur la durée choisie.",
        audios: [] as { label: string; path: string }[],
      },
    ],
  },
  {
    id: "relaxation",
    titre: "Relaxation",
    icone: "🌊",
    couleur: "#60A5FA",
    description: "Calme le système nerveux et réduit le stress.",
    criteres: {
      temps: ["30 sec", "1 min", "2 min"],
      moment: ["Avant le match", "Pendant le match", "Après le match"],
      posture: ["Assis", "Debout", "En marchant", "En bulle collective"],
    },
    exercices: [
      {
        id: "4-6",
        titre: "Exercice 4-6",
        description: "Inspire 4 secondes par le nez, expire 6 secondes par la bouche. Ralentit le rythme cardiaque et favorise la récupération.",
        instruction: "🌬 Inspire doucement 4 secondes par le nez, expire lentement 6 secondes par la bouche.",
        audios: [] as { label: string; path: string }[],
      },
    ],
  },
  {
    id: "scan",
    titre: "Scan corporel",
    icone: "🧘",
    couleur: "#A78BFA",
    description: "Connexion au corps, relâchement des tensions.",
    criteres: {} as Record<string, string[]>,
    exercices: [
      {
        id: "scan-1",
        titre: "Scan corporel 1",
        description: "Parcours du corps de la tête aux pieds, identification et relâchement des zones de tension.",
        instruction: "",
        audios: [{ label: "▶ Écouter", path: "scan.m4a" }],
      },
      {
        id: "scan-2",
        titre: "Scan corporel 2",
        description: "A venir !",
        instruction: "",
        audios: [{ label: "▶ Écouter", path: "scan-corporel-2.mp3" }],
      },
    ],
  },
] as const;

type CategorieId = typeof CATEGORIES[number]["id"];

// Typage étendu pour les données sauvegardées
interface RespiExt {
  id: string;
  joueur_id: string;
  date: string;
  commentaire: string;
  contexte: CategorieId;
  exercice: string;
  temps?: string;
  moment?: string;
  posture?: string;
}

const STORAGE_AUDIO_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/pm/`;
const inputStyle = { background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)" } as React.CSSProperties;
const labelStyle = { display: "block", fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "var(--text-sub)", marginBottom: "0.5rem" };

// ─── Composant chip de sélection ──────────────────────────────────────────────
function ChipGroup({ options, value, onChange, couleur }: { options: readonly string[]; value: string; onChange: (v: string) => void; couleur: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button key={opt} type="button" onClick={() => onChange(active ? "" : opt)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              background: active ? `color-mix(in srgb, ${couleur} 15%, transparent)` : "var(--bg-input)",
              border: `1px solid ${active ? couleur : "var(--border)"}`,
              color: active ? couleur : "var(--text-muted)",
            }}>
            {opt}
          </button>
        );
      })}
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

// ─── Composant principal ──────────────────────────────────────────────────────
export default function RespirationTab({ userId, readOnly = false, onSave }: { userId: string; readOnly?: boolean; onSave?: () => void }) {
  const [historique, setHistorique] = useState<RespiExt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<RespiExt | null>(null);

  const [categorieActive, setCategorieActive] = useState<CategorieId>("activation");
  const [dateS, setDateS] = useState(new Date().toISOString().split("T")[0]);
  const [commentaire, setCommentaire] = useState("");
  const [exerciceChoisi, setExerciceChoisi] = useState<string | null>(
    CATEGORIES.find(c => c.id === "activation")?.exercices[0]?.id ?? null
  );
  const [tempsChoisi, setTempsChoisi] = useState("");
  const [momentChoisi, setMomentChoisi] = useState("");
  const [postureChoisie, setPostureChoisie] = useState("");

  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<Record<string, number>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});

  const load = async () => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    const { data } = await supabase.from("suivi_respiration").select("*").eq("joueur_id", userId)
      .gte("date", d.toISOString().split("T")[0]).order("date", { ascending: false });
    setHistorique((data ?? []) as RespiExt[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [userId]);

  const resetForm = () => {
    setEditingItem(null); setCommentaire(""); setExerciceChoisi(null);
    setTempsChoisi(""); setMomentChoisi(""); setPostureChoisie("");
    setDateS(new Date().toISOString().split("T")[0]);
  };

  const resetCriteres = (catId?: string) => {
    setTempsChoisi(""); setMomentChoisi(""); setPostureChoisie("");
    const cat = CATEGORIES.find(c => c.id === (catId ?? categorieActive));
    setExerciceChoisi(cat?.exercices[0]?.id ?? null);
  };

  const startEdit = (item: RespiExt) => {
    setEditingItem(item);
    setDateS(item.date);
    setCommentaire(item.commentaire ?? "");
    setCategorieActive(item.contexte ?? "activation");
    setExerciceChoisi(item.exercice ?? null);
    setTempsChoisi(item.temps ?? "");
    setMomentChoisi(item.moment ?? "");
    setPostureChoisie(item.posture ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleAudio = (key: string, path: string) => {
    if (playingKey === key) { audioRefs.current[key]?.pause(); setPlayingKey(null); return; }
    if (playingKey && audioRefs.current[playingKey]) audioRefs.current[playingKey].pause();
    if (!audioRefs.current[key]) {
      const audio = new Audio(STORAGE_AUDIO_BASE + path);
      audio.ontimeupdate = () => {
        const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
        setAudioProgress((prev) => ({ ...prev, [key]: pct }));
      };
      audio.onended = () => { setPlayingKey(null); setAudioProgress((prev) => ({ ...prev, [key]: 0 })); };
      audioRefs.current[key] = audio;
    }
    audioRefs.current[key].play().catch(() => {});
    setPlayingKey(key);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    const payload = {
      date: dateS,
      contexte: categorieActive,
      exercice: exerciceChoisi,
      commentaire,
      temps: tempsChoisi || null,
      moment: momentChoisi || null,
      posture: postureChoisie || null,
    };
    if (editingItem) {
      await supabase.from("suivi_respiration").update(payload).eq("id", editingItem.id);
    } else {
      await supabase.from("suivi_respiration").insert({ joueur_id: userId, ...payload });
    }
    setSaved(true); setTimeout(() => setSaved(false), 3000); onSave?.();
    resetForm(); await load(); setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("suivi_respiration").delete().eq("id", id);
    setDeleteConfirm(null); if (editingItem?.id === id) resetForm(); await load();
  };

  const categorieSelectionnee = CATEGORIES.find((c) => c.id === categorieActive)!;
  const hasCriteres = Object.keys(categorieSelectionnee.criteres).length > 0;

  return (
    <div className="space-y-5">
      {/* Sélecteur catégorie */}
      <div className="grid grid-cols-3 gap-2">
        {CATEGORIES.map((cat) => {
          const isActive = categorieActive === cat.id;
          return (
            <button key={cat.id} type="button"
              onClick={() => { setCategorieActive(cat.id as CategorieId); if (!editingItem) resetCriteres(cat.id); }}
              className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl transition-all duration-200"
              style={{
                background: isActive ? `color-mix(in srgb, ${cat.couleur} 12%, var(--bg-card))` : "var(--bg-input)",
                border: isActive ? `2px solid ${cat.couleur}` : "2px solid var(--border)",
                boxShadow: isActive ? `0 0 16px color-mix(in srgb, ${cat.couleur} 18%, transparent)` : "none",
              }}>
              <span className="text-2xl">{cat.icone}</span>
              <span className="text-xs font-medium" style={{ color: isActive ? cat.couleur : "var(--text-muted)" }}>{cat.titre}</span>
            </button>
          );
        })}
      </div>

      {/* Description */}
      <div className="rounded-xl px-4 py-3 text-sm"
        style={{ background: `color-mix(in srgb, ${categorieSelectionnee.couleur} 6%, var(--bg-card))`, border: `1px solid color-mix(in srgb, ${categorieSelectionnee.couleur} 15%, transparent)`, color: "var(--text-sub)" }}>
        {categorieSelectionnee.icone} <strong style={{ color: categorieSelectionnee.couleur }}>{categorieSelectionnee.titre}</strong> — {categorieSelectionnee.description}
      </div>

      {/* Exercices */}
      <div className="space-y-3">
        {categorieSelectionnee.exercices.map((ex) => {
          const isSelected = exerciceChoisi === ex.id;
          return (
            <Card key={ex.id}>
              <div className="cursor-pointer rounded-xl transition-all"
                onClick={() => setExerciceChoisi(isSelected ? null : ex.id)}
                style={isSelected ? { outline: `2px solid ${categorieSelectionnee.couleur}`, outlineOffset: "3px" } : {}}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm" style={{ color: "var(--text-main)" }}>{ex.titre}</span>
                      {isSelected && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: `color-mix(in srgb, ${categorieSelectionnee.couleur} 15%, transparent)`, color: categorieSelectionnee.couleur }}>
                          ✓ Sélectionné
                        </span>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>{ex.description}</p>
                  </div>
                </div>

                {/* Audio pour le scan */}
                {ex.audios.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {ex.audios.map((audio) => {
                      const key = `${ex.id}__${audio.path}`;
                      const isPlaying = playingKey === key;
                      const progress = audioProgress[key] ?? 0;
                      return (
                        <div key={key} className="flex items-center gap-2 flex-1 min-w-0">
                          <button type="button" onClick={(e2) => { e2.stopPropagation(); toggleAudio(key, audio.path); }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all shrink-0"
                            style={{
                              background: isPlaying ? `color-mix(in srgb, ${categorieSelectionnee.couleur} 15%, transparent)` : "var(--bg-input)",
                              border: `1px solid ${isPlaying ? categorieSelectionnee.couleur : "var(--border)"}`,
                              color: isPlaying ? categorieSelectionnee.couleur : "var(--text-sub)",
                            }}>
                            {isPlaying ? (
                              <span className="flex items-end gap-px h-3">
                                {[0, 0.15, 0.3].map((delay, i) => (
                                  <span key={i} className="w-0.5 rounded-full"
                                    style={{ height: "100%", background: categorieSelectionnee.couleur, animation: `pulse-dot 0.8s ease-in-out ${delay}s infinite` }} />
                                ))}
                              </span>
                            ) : "▶"}
                            {audio.label}
                          </button>
                          {progress > 0 && (
                            <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
                              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: categorieSelectionnee.couleur }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Instructions texte */}
                {ex.audios.length === 0 && ex.instruction && (
                  <div className="mt-2 text-xs px-3 py-2 rounded-lg"
                    style={{ background: `color-mix(in srgb, ${categorieSelectionnee.couleur} 6%, var(--bg-input))`, color: "var(--text-muted)", border: `1px solid color-mix(in srgb, ${categorieSelectionnee.couleur} 10%, transparent)` }}>
                    {ex.instruction}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* ── Critères contextuels (activation & relaxation) ── */}
      {hasCriteres && exerciceChoisi && (() => {
        const criteres = categorieSelectionnee.criteres as Record<string, readonly string[]>;
        return (
          <Card>
            <p className="text-xs font-medium tracking-widest uppercase mb-4" style={{ color: "var(--text-sub)" }}>
              Contexte de la séance
            </p>
            <div className="space-y-4">
              {criteres.temps && (
                <div>
                  <label style={labelStyle}>⏱ Durée</label>
                  <ChipGroup options={criteres.temps} value={tempsChoisi} onChange={setTempsChoisi} couleur={categorieSelectionnee.couleur} />
                </div>
              )}
              {criteres.moment && (
                <div>
                  <label style={labelStyle}>🕐 Moment</label>
                  <ChipGroup options={criteres.moment} value={momentChoisi} onChange={setMomentChoisi} couleur={categorieSelectionnee.couleur} />
                </div>
              )}
              {criteres.posture && (
                <div>
                  <label style={labelStyle}>🧍 Posture</label>
                  <ChipGroup options={criteres.posture} value={postureChoisie} onChange={setPostureChoisie} couleur={categorieSelectionnee.couleur} />
                </div>
              )}
            </div>
          </Card>
        );
      })()}

      {/* Formulaire enregistrement */}
      {!readOnly && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl court-line pb-3" style={{ color: "var(--text-main)" }}>
              {editingItem ? "MODIFIER LA SÉANCE" : "ENREGISTRER UNE SÉANCE"}
            </h2>
            {editingItem && (
              <button onClick={resetForm} className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-main)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
                ✕ Annuler
              </button>
            )}
          </div>
          {editingItem && (
            <div className="rounded-lg px-4 py-2.5 mb-4 text-sm"
              style={{ background: "color-mix(in srgb, var(--accent) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)", color: "var(--text-sub)" }}>
              ✏️ Mode modification
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label style={labelStyle}>Date</label>
              <input type="date" value={dateS} onChange={(e) => setDateS(e.target.value)}
                className="w-full px-4 py-3 rounded-xl outline-none" style={{ ...inputStyle, colorScheme: "dark" }} />
            </div>

            {/* Récap exercice + critères sélectionnés */}
            {exerciceChoisi && (
              <div className="rounded-lg px-4 py-3 text-xs space-y-1"
                style={{ background: `color-mix(in srgb, ${categorieSelectionnee.couleur} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${categorieSelectionnee.couleur} 20%, transparent)` }}>
                <div className="flex items-center gap-2">
                  <span style={{ color: categorieSelectionnee.couleur }}>✓</span>
                  <span style={{ color: "var(--text-main)", fontWeight: 600 }}>{categorieSelectionnee.titre}</span>
                  <span style={{ color: "var(--text-sub)" }}>—</span>
                  <span style={{ color: "var(--text-sub)" }}>{categorieSelectionnee.exercices.find(e => e.id === exerciceChoisi)?.titre}</span>
                </div>
                {(tempsChoisi || momentChoisi || postureChoisie) && (
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {tempsChoisi && <span className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: `color-mix(in srgb, ${categorieSelectionnee.couleur} 10%, transparent)`, color: categorieSelectionnee.couleur }}>⏱ {tempsChoisi}</span>}
                    {momentChoisi && <span className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: `color-mix(in srgb, ${categorieSelectionnee.couleur} 10%, transparent)`, color: categorieSelectionnee.couleur }}>🕐 {momentChoisi}</span>}
                    {postureChoisie && <span className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: `color-mix(in srgb, ${categorieSelectionnee.couleur} 10%, transparent)`, color: categorieSelectionnee.couleur }}>🧍 {postureChoisie}</span>}
                  </div>
                )}
              </div>
            )}

            <div>
              <label style={labelStyle}>Commentaire (optionnel)</label>
              <textarea value={commentaire} onChange={(e) => setCommentaire(e.target.value)} rows={3}
                placeholder="Ressenti après l'exercice, observations..."
                className="w-full px-4 py-3 rounded-xl outline-none resize-none" style={inputStyle} />
            </div>
            {saved && (
              <div className="rounded-lg px-4 py-3 text-sm animate-slide-in" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", color: "#86efac" }}>
                {editingItem ? "✅ Séance modifiée !" : "✅ Séance enregistrée !"}
              </div>
            )}
            <button type="submit" disabled={saving}
              className="w-full py-3.5 rounded-xl font-display text-lg tracking-widest transition-all disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, var(--accent), var(--accent2))", color: "white", boxShadow: "0 4px 20px var(--accent-glow)" }}>
              {saving ? "Enregistrement..." : editingItem ? "MODIFIER" : "ENREGISTRER"}
            </button>
          </form>
        </Card>
      )}

      {/* Historique */}
      <div>
        <h3 className="font-display text-xl mb-4" style={{ color: "var(--text-main)" }}>HISTORIQUE (30 DERNIERS JOURS)</h3>
        {loading ? (
          <div className="flex justify-center py-8"><div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} /></div>
        ) : historique.length === 0 ? (
          <Card><p className="text-center py-4" style={{ color: "var(--text-muted)" }}>Aucune séance ces 30 derniers jours.</p></Card>
        ) : (
          <div className="space-y-3">
            {historique.map((h, i) => {
              const cat = CATEGORIES.find((c) => c.id === h.contexte);
              return (
                <div key={h.id} className="animate-fade-in-up" style={{ animationDelay: `${i * 0.05}s`, opacity: 0, animationFillMode: "forwards" }}>
                  <Card>
                    <div style={editingItem?.id === h.id ? { outline: "2px solid var(--accent)", outlineOffset: "3px", borderRadius: "8px" } : {}}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center flex-wrap gap-2 mb-1">
                            <span className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--text-sub)" }}>
                              {new Date(h.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                            </span>
                            {cat && (
                              <span className="text-xs px-2 py-0.5 rounded-full"
                                style={{ background: `color-mix(in srgb, ${cat.couleur} 12%, transparent)`, color: cat.couleur }}>
                                {cat.icone} {cat.titre}
                              </span>
                            )}
                          </div>
                          {h.exercice && (
                            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                              <span style={{ color: "var(--text-sub)" }}>Exercice :</span>{" "}
                              {cat?.exercices.find(e => e.id === h.exercice)?.titre ?? h.exercice}
                            </p>
                          )}
                          {/* Critères contextuels */}
                          {(h.temps || h.moment || h.posture) && (
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {h.temps && <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `color-mix(in srgb, ${cat?.couleur ?? "var(--accent)"} 10%, transparent)`, color: cat?.couleur ?? "var(--accent)" }}>⏱ {h.temps}</span>}
                              {h.moment && <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `color-mix(in srgb, ${cat?.couleur ?? "var(--accent)"} 10%, transparent)`, color: cat?.couleur ?? "var(--accent)" }}>🕐 {h.moment}</span>}
                              {h.posture && <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `color-mix(in srgb, ${cat?.couleur ?? "var(--accent)"} 10%, transparent)`, color: cat?.couleur ?? "var(--accent)" }}>🧍 {h.posture}</span>}
                            </div>
                          )}
                          {h.commentaire && <p className="text-xs mt-1.5 italic" style={{ color: "var(--text-muted)" }}>&ldquo;{h.commentaire}&rdquo;</p>}
                        </div>
                        {!readOnly && (
                          <div className="flex gap-1.5 shrink-0">
                            {deleteConfirm === h.id ? (
                              <>
                                <button onClick={() => handleDelete(h.id)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}>Confirmer</button>
                                <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>Annuler</button>
                              </>
                            ) : (
                              <>
                                <IconBtn onClick={() => startEdit(h)} title="Modifier" icon="✏️" />
                                <IconBtn onClick={() => setDeleteConfirm(h.id)} title="Supprimer" icon="🗑" danger />
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
