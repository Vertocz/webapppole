// components/PushNotificationPanel.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import NotifModal from "@/components/NotifModal";
import type { Joueuse, Staff } from "@/types";

type Pole      = "masculin" | "feminin" | "both";
type TargetRole = "all" | "player" | "staff";
type PersonMode = "joueurs" | "staff";

interface Props {
  staffId: string;
  pole:    Pole;
}

interface NotificationHistory {
  id:               string;
  title:            string;
  body:             string;
  target_pole:      Pole | null;
  target_role:      string | null;
  target_users:     string[] | null;
  recipients_count: number;
  sent_at:          string;
}

interface JoueusePlus extends Joueuse { subscribed: boolean; }
interface StaffPlus   extends Staff   { subscribed: boolean; }

export default function PushNotificationPanel({ staffId, pole }: Props) {

  // ── Formulaire ────────────────────────────────────────────────────────────
  const [title,            setTitle]            = useState("");
  const [body,             setBody]             = useState("");
  const [targetRole,       setTargetRole]       = useState<TargetRole>("all");
  const [targetPole,       setTargetPole]       = useState<Pole>(pole === "both" ? "both" : pole);
  const [selectedUsers,    setSelectedUsers]    = useState<string[]>([]);
  const [useSpecificUsers, setUseSpecificUsers] = useState(false);
  const [personMode,       setPersonMode]       = useState<PersonMode>("joueurs");
  const [searchPlayer,     setSearchPlayer]     = useState("");
  const [showOnlySubbed,   setShowOnlySubbed]   = useState(true);

  // ── Données ───────────────────────────────────────────────────────────────
  const [joueurs,  setJoueurs]  = useState<JoueusePlus[]>([]);
  const [staffList, setStaffList] = useState<StaffPlus[]>([]);
  const [history,  setHistory]  = useState<NotificationHistory[]>([]);

  // ── UI ────────────────────────────────────────────────────────────────────
  const [sending,    setSending]    = useState(false);
  const [feedback,   setFeedback]   = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [activeTab,  setActiveTab]  = useState<"compose" | "history">("compose");
  const [modalNotifId, setModalNotifId] = useState<string | null>(null);

  // ── Chargement ────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {

    // 1. Joueurs du scope
    let q = supabase.from("joueuses").select("id, prenom, nom, numero_tel, categorie");
    if (pole === "masculin") q = q.eq("categorie", "Masculin");
    else if (pole === "feminin") q = q.eq("categorie", "Féminin");
    const { data: joueusesData } = await q.order("prenom", { ascending: true });

    // 2. Staff (tous sauf soi-même)
    const { data: staffData } = await supabase
      .from("staff")
      .select("id, prenom, nom, numero_tel, masculin, feminin")
      .neq("id", staffId)
      .order("prenom", { ascending: true });

    // 3. Subscriptions actives
    const allIds = [
      ...(joueusesData ?? []).map(j => j.id),
      ...(staffData    ?? []).map(s => s.id),
    ];
    const { data: subsData } = await supabase
      .from("push_subscriptions")
      .select("user_id")
      .in("user_id", allIds)
      .or("opted_out.is.null,opted_out.eq.false");
    const subscribedIds = new Set((subsData ?? []).map(s => s.user_id));

    setJoueurs((joueusesData ?? []).map(j => ({ ...j, subscribed: subscribedIds.has(j.id) })));
    setStaffList((staffData ?? []).map(s => ({ ...s, subscribed: subscribedIds.has(s.id) })));

    // 4. Historique — filtré par l'expéditeur courant
    const { data: hist } = await supabase
      .from("push_notifications")
      .select("id, title, body, target_pole, target_role, target_users, recipients_count, sent_at")
      .eq("sent_by", staffId)
      .order("sent_at", { ascending: false })
      .limit(30);
    if (hist) setHistory(hist);

  }, [pole, staffId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Envoi ─────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!title.trim() || !body.trim()) {
      setFeedback({ type: "error", msg: "Le titre et le message sont requis." });
      return;
    }
    if (useSpecificUsers && selectedUsers.length === 0) {
      setFeedback({ type: "error", msg: "Sélectionne au moins un destinataire." });
      return;
    }

    setSending(true);
    setFeedback(null);

    const payload: Record<string, unknown> = {
      staff_id:    staffId,
      title, body,
      target_pole: targetPole === "both" ? undefined : targetPole,
    };

    if (useSpecificUsers) {
      payload.target_users = selectedUsers;
    } else if (targetRole !== "all") {
      payload.target_role = targetRole;
    }

    try {
      const res  = await fetch("/api/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        setFeedback({ type: "error", msg: data.error ?? "Erreur inconnue." });
      } else {
        setFeedback({
          type: "success",
          msg: `✓ Envoyé à ${data.sent} appareil${data.sent > 1 ? "s" : ""} sur ${data.total}.`,
        });
        setTitle(""); setBody(""); setSelectedUsers([]);
        setUseSpecificUsers(false); setTargetRole("all");
        loadData();
      }
    } catch {
      setFeedback({ type: "error", msg: "Erreur réseau." });
    } finally {
      setSending(false);
    }
  };

  const toggleUser = (id: string) =>
    setSelectedUsers(prev => prev.includes(id) ? prev.filter(u => u !== id) : [...prev, id]);

  // ── Filtres ───────────────────────────────────────────────────────────────
  const filteredJoueurs = joueurs
    .filter(j => {
      if (pole === "both" && targetPole !== "both")
        return j.categorie === (targetPole === "masculin" ? "Masculin" : "Féminin");
      return true;
    })
    .filter(j => `${j.prenom} ${j.nom}`.toLowerCase().includes(searchPlayer.toLowerCase()))
    .filter(j => showOnlySubbed ? j.subscribed : true);

  const filteredStaff = staffList
    .filter(s => `${s.prenom} ${s.nom}`.toLowerCase().includes(searchPlayer.toLowerCase()))
    .filter(s => showOnlySubbed ? s.subscribed : true);

  const subbedCount = personMode === "joueurs"
    ? joueurs.filter(j => {
        if (pole === "both" && targetPole !== "both")
          return j.subscribed && j.categorie === (targetPole === "masculin" ? "Masculin" : "Féminin");
        return j.subscribed;
      }).length
    : staffList.filter(s => s.subscribed).length;

  const currentList = personMode === "joueurs" ? filteredJoueurs : filteredStaff;

  const poleLabel = (p: Pole | null) =>
    !p ? "Tous" : p === "masculin" ? "Pôle M" : p === "feminin" ? "Pôle F" : "Tous pôles";

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="space-y-4">

        {/* Tabs */}
        <div className="flex rounded-xl p-1 gap-1"
          style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
          {(["compose", "history"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all"
              style={activeTab === tab
                ? { background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white", boxShadow: "0 2px 12px var(--accent-glow)" }
                : { color: "var(--text-muted)" }}>
              <span>{tab === "compose" ? "✏️" : "📋"}</span>
              <span>{tab === "compose" ? "Composer" : "Historique"}</span>
            </button>
          ))}
        </div>

        {/* ── Composer ──────────────────────────────────────────────────────── */}
        {activeTab === "compose" && (
          <div className="space-y-4">

            {feedback && (
              <div className="rounded-xl px-4 py-3 text-sm font-medium"
                style={{
                  background: feedback.type === "success" ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
                  border: `1px solid ${feedback.type === "success" ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)"}`,
                  color: feedback.type === "success" ? "#4ade80" : "#f87171",
                }}>
                {feedback.msg}
              </div>
            )}

            {/* Titre */}
            <div className="space-y-1.5">
              <label style={{ fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-sub)" }}>
                Titre
              </label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} maxLength={60}
                placeholder="Ex : Entraînement annulé"
                className="w-full rounded-xl px-4 py-3 text-sm transition-colors focus:outline-none"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)" }} />
              <p className="text-right text-xs" style={{ color: "var(--text-muted)" }}>{title.length}/60</p>
            </div>

            {/* Message */}
            <div className="space-y-1.5">
              <label style={{ fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-sub)" }}>
                Message
              </label>
              <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={200} rows={3}
                placeholder="Ex : La séance de ce soir est annulée."
                className="w-full rounded-xl px-4 py-3 text-sm transition-colors focus:outline-none resize-none"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)" }} />
              <p className="text-right text-xs" style={{ color: "var(--text-muted)" }}>{body.length}/200</p>
            </div>

            {/* Aperçu */}
            {(title || body) && (
              <div className="rounded-xl p-4" style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
                <p style={{ fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-sub)", marginBottom: "0.5rem" }}>
                  Aperçu
                </p>
                <div className="flex gap-3 items-start rounded-xl p-3" style={{ background: "var(--bg-card)" }}>
                  <div className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-lg"
                    style={{ background: "var(--accent)", opacity: 0.9 }}>🏀</div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text-main)" }}>{title || "Titre…"}</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {body || "Message…"}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Pôle (si staff both) */}
            {pole === "both" && (
              <div className="space-y-1.5">
                <label style={{ fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-sub)" }}>
                  Pôle
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(["both", "masculin", "feminin"] as const).map(p => (
                    <button key={p} onClick={() => { setTargetPole(p); setSelectedUsers([]); }}
                      className="py-2.5 rounded-xl text-sm font-medium transition-all"
                      style={{
                        background: targetPole === p ? "linear-gradient(135deg,var(--accent),var(--accent2))" : "var(--bg-input)",
                        border: targetPole === p ? "none" : "1px solid var(--border)",
                        color: targetPole === p ? "white" : "var(--text-muted)",
                        boxShadow: targetPole === p ? "0 2px 12px var(--accent-glow)" : "none",
                      }}>
                      {p === "both" ? "Tous" : p === "masculin" ? "Pôle M" : "Pôle F"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Destinataires */}
            <div className="space-y-3">
              <label style={{ fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-sub)" }}>
                Destinataires
              </label>

              {/* Toggle segment / précis */}
              <div className="flex gap-2">
                {[{ key: false, label: "Par segment" }, { key: true, label: "Précis" }].map(({ key, label }) => (
                  <button key={String(key)} onClick={() => { setUseSpecificUsers(key); setSelectedUsers([]); }}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
                    style={{
                      border: `1px solid ${useSpecificUsers === key ? "color-mix(in srgb, var(--accent) 50%, transparent)" : "var(--border)"}`,
                      background: useSpecificUsers === key ? "color-mix(in srgb, var(--accent) 12%, var(--bg-card))" : "transparent",
                      color: useSpecificUsers === key ? "var(--text-main)" : "var(--text-muted)",
                    }}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Segment */}
              {!useSpecificUsers && (
                <div className="grid grid-cols-3 gap-2">
                  {(["all", "player", "staff"] as TargetRole[]).map(r => (
                    <button key={r} onClick={() => setTargetRole(r)}
                      className="py-2.5 rounded-xl text-sm font-medium transition-all"
                      style={{
                        background: targetRole === r ? "linear-gradient(135deg,var(--accent),var(--accent2))" : "var(--bg-input)",
                        border: targetRole === r ? "none" : "1px solid var(--border)",
                        color: targetRole === r ? "white" : "var(--text-muted)",
                        boxShadow: targetRole === r ? "0 2px 12px var(--accent-glow)" : "none",
                      }}>
                      {r === "all" ? "Tous" : r === "player" ? "Joueurs" : "Staff"}
                    </button>
                  ))}
                </div>
              )}

              {/* Sélection précise */}
              {useSpecificUsers && (
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>

                  {/* Toggle joueurs / staff */}
                  <div className="flex border-b" style={{ borderColor: "var(--border)" }}>
                    {(["joueurs", "staff"] as PersonMode[]).map(m => (
                      <button key={m} onClick={() => { setPersonMode(m); setSelectedUsers([]); setSearchPlayer(""); }}
                        className="flex-1 py-2.5 text-xs font-bold tracking-widest uppercase transition-all"
                        style={{
                          background: personMode === m ? "color-mix(in srgb, var(--accent) 10%, var(--bg-input))" : "var(--bg-input)",
                          color: personMode === m ? "var(--accent)" : "var(--text-muted)",
                          borderBottom: personMode === m ? "2px solid var(--accent)" : "2px solid transparent",
                        }}>
                        {m === "joueurs" ? "⛹️ Joueurs" : "👤 Staff"}
                      </button>
                    ))}
                  </div>

                  {/* Barre de recherche + toggle abonnés */}
                  <div className="p-3 space-y-2" style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-input)" }}>
                    <input type="text" value={searchPlayer} onChange={e => setSearchPlayer(e.target.value)}
                      placeholder="Rechercher…"
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-main)" }} />
                    <button onClick={() => { setShowOnlySubbed(v => !v); setSelectedUsers([]); }}
                      className="flex items-center gap-2 text-xs transition-all"
                      style={{ color: showOnlySubbed ? "var(--accent)" : "var(--text-muted)" }}>
                      <div className="w-8 h-4 rounded-full relative transition-colors"
                        style={{ background: showOnlySubbed ? "var(--accent)" : "var(--border)" }}>
                        <div className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                          style={{ left: showOnlySubbed ? "calc(100% - 14px)" : "2px" }} />
                      </div>
                      {showOnlySubbed ? `Abonnés seulement (${subbedCount})` : "Tous"}
                    </button>
                  </div>

                  {selectedUsers.length > 0 && (
                    <div className="px-3 py-2 flex items-center justify-between"
                      style={{ background: "color-mix(in srgb, var(--accent) 10%, var(--bg-card))", borderBottom: "1px solid var(--border)" }}>
                      <span className="text-xs font-medium" style={{ color: "var(--accent)" }}>
                        {selectedUsers.length} sélectionné{selectedUsers.length > 1 ? "s" : ""}
                      </span>
                      <button onClick={() => setSelectedUsers([])} className="text-xs" style={{ color: "var(--text-muted)" }}>
                        Tout déselectionner
                      </button>
                    </div>
                  )}

                  <div className="max-h-48 overflow-y-auto" style={{ background: "var(--bg-card)" }}>
                    {currentList.length === 0 ? (
                      <p className="text-sm text-center py-4" style={{ color: "var(--text-muted)" }}>
                        {showOnlySubbed ? "Aucun abonné dans ce périmètre" : "Aucun résultat"}
                      </p>
                    ) : (
                      currentList.map(person => {
                        const selected = selectedUsers.includes(person.id);
                        const isJoueur = personMode === "joueurs";
                        const joueur   = isJoueur ? person as JoueusePlus : null;
                        return (
                          <button key={person.id} onClick={() => toggleUser(person.id)}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                            style={{
                              background: selected ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent",
                              borderBottom: "1px solid var(--border)",
                            }}>
                            <div className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                              style={{ border: `2px solid ${selected ? "var(--accent)" : "var(--border)"}`, background: selected ? "var(--accent)" : "transparent" }}>
                              {selected && <span style={{ color: "white", fontSize: "10px" }}>✓</span>}
                            </div>
                            <span className="text-sm flex-1" style={{ color: "var(--text-main)" }}>
                              {person.prenom} {person.nom}
                            </span>
                            {!showOnlySubbed && (
                              <span className="text-[10px]" title={person.subscribed ? "Abonné" : "Non abonné"}>
                                {person.subscribed ? "🔔" : "🔕"}
                              </span>
                            )}
                            {isJoueur && joueur && (
                              <span className="text-xs px-2 py-0.5 rounded-full"
                                style={{
                                  background: joueur.categorie === "Masculin" ? "rgba(59,130,246,0.15)" : "rgba(236,72,153,0.15)",
                                  color: joueur.categorie === "Masculin" ? "#60a5fa" : "#f472b6",
                                }}>
                                {joueur.categorie === "Masculin" ? "M" : "F"}
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Récap + bouton envoi */}
            <div className="rounded-xl p-4 space-y-3"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span style={{ color: "var(--text-muted)" }}>Pôle</span>
                  <span style={{ color: "var(--text-main)" }}>{poleLabel(targetPole)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span style={{ color: "var(--text-muted)" }}>Destinataires</span>
                  <span style={{ color: "var(--text-main)" }}>
                    {useSpecificUsers
                      ? selectedUsers.length > 0
                        ? `${selectedUsers.length} ${personMode === "staff" ? "membre" : "joueur"}${selectedUsers.length > 1 ? "s" : ""}`
                        : "Aucun sélectionné"
                      : targetRole === "all" ? "Joueurs + Staff"
                      : targetRole === "player" ? "Joueurs uniquement"
                      : "Staff uniquement"}
                  </span>
                </div>
              </div>

              <button onClick={handleSend}
                disabled={sending || !title.trim() || !body.trim() || (useSpecificUsers && selectedUsers.length === 0)}
                className="w-full py-3.5 rounded-xl font-display tracking-widest text-sm transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white", boxShadow: "0 4px 16px var(--accent-glow)" }}>
                {sending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Envoi…
                  </span>
                ) : "ENVOYER"}
              </button>
            </div>
          </div>
        )}

        {/* ── Historique ────────────────────────────────────────────────────── */}
        {activeTab === "history" && (
          <div className="space-y-3">
            {history.length === 0 ? (
              <div className="text-center py-12" style={{ color: "var(--text-muted)" }}>
                <div className="text-3xl mb-2">📭</div>
                <p className="text-sm">Aucune notification envoyée</p>
              </div>
            ) : (
              history.map(notif => (
                <button key={notif.id}
                  onClick={() => setModalNotifId(notif.id)}
                  className="w-full text-left rounded-xl p-4 space-y-2 transition-all active:scale-[0.98]"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold leading-tight" style={{ color: "var(--text-main)" }}>
                      {notif.title}
                    </p>
                    <span className="text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                      {formatDate(notif.sent_at)}
                    </span>
                  </div>
                  <p className="text-sm leading-snug line-clamp-2" style={{ color: "var(--text-sub)" }}>{notif.body}</p>
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    <span className="text-xs px-2 py-1 rounded-full" style={{ background: "var(--bg-input)", color: "var(--text-muted)" }}>
                      {poleLabel(notif.target_pole)}
                    </span>
                    <span className="text-xs px-2 py-1 rounded-full" style={{ background: "var(--bg-input)", color: "var(--text-muted)" }}>
                      {notif.target_users
                        ? `${notif.target_users.length} ciblé${notif.target_users.length > 1 ? "s" : ""}`
                        : notif.target_role === "player" ? "Joueurs"
                        : notif.target_role === "staff"  ? "Staff"
                        : "Tous"}
                    </span>
                    <span className="ml-auto text-xs font-medium" style={{ color: "#4ade80" }}>
                      ✓ {notif.recipients_count} envoyé{notif.recipients_count > 1 ? "s" : ""}
                    </span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>· Voir ›</span>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Modale notification cliquée */}
      {modalNotifId && (
        <NotifModal notifId={modalNotifId} onClose={() => setModalNotifId(null)} />
      )}
    </>
  );
}