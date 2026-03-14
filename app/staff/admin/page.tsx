"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import ThemeProvider from "@/components/ThemeProvider";
import PushNotificationPanel from "@/components/PushNotificationPanel";
import ManualBadgeAssign from "@/components/ManualBadgeAssign";
import type { Staff, Joueuse } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UploadedFile {
  name: string;
  size: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

type AdminTab = "billets" | "joueurs" | "notifications" | "badges";

interface ConfirmModal {
  title: string;
  message: string;
  onConfirm: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [user,    setUser]    = useState<Staff | null>(null);
  const [tab,     setTab]     = useState<AdminTab>("billets");
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const stored = sessionStorage.getItem("user");
    const type   = sessionStorage.getItem("type_user");
    if (!stored || type !== "staff") { router.push("/"); return; }
    setUser(JSON.parse(stored) as Staff);
    setLoading(false);
  }, [router]);

  if (loading || !user) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
    </div>
  );

  const pole: "masculin" | "feminin" | "both" =
    user.masculin && user.feminin ? "both" : user.masculin ? "masculin" : "feminin";

  const tabs: { id: AdminTab; label: string; icon: string }[] = [
    { id: "billets",       label: "Billets",       icon: "🎫" },
    { id: "joueurs",       label: "Joueurs",        icon: "👥" },
    { id: "badges",        label: "Badges",         icon: "🏅" },
    { id: "notifications", label: "Notifications",  icon: "🔔" },
  ];

  return (
    <>
      <ThemeProvider theme="staff" />
      <div className="relative min-h-screen z-10">

        {/* Stripe top */}
        <div className="h-0.5 w-full"
          style={{ background: "linear-gradient(90deg,var(--primary),var(--accent),var(--primary))" }} />

        {/* Header */}
        <header className="sticky top-0 z-50 px-4 py-3"
          style={{ background: "color-mix(in srgb, var(--bg-base) 92%, transparent)",
            backdropFilter: "blur(14px)", borderBottom: "1px solid var(--border)" }}>
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => router.push("/staff")}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-opacity hover:opacity-70"
                style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                ←
              </button>
              <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0" style={{ background: "white", padding: "3px" }}>
                <Image src="/logo.png" alt="Logo" width={30} height={30} style={{ objectFit: "contain" }} />
              </div>
              <div>
                <p className="font-display text-base leading-none" style={{ color: "var(--text-main)" }}>ADMIN</p>
                <p className="text-[10px] tracking-widest uppercase font-light" style={{ color: "var(--text-sub)" }}>
                  {user.prenom} {user.nom}
                </p>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">

          {/* Tabs */}
          <div className="overflow-x-auto scrollbar-hide -mx-4 px-4">
            <div className="flex rounded-xl p-1 gap-1 w-max min-w-full"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
              {tabs.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap"
                  style={tab === t.id
                    ? { background: "linear-gradient(135deg,var(--accent),var(--accent2))",
                        color: "white", boxShadow: "0 2px 12px var(--accent-glow)" }
                    : { color: "var(--text-muted)" }}>
                  <span>{t.icon}</span><span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {tab === "billets"       && <BilletsPanel />}
          {tab === "joueurs"       && <JoueursPanel user={user} />}
          {tab === "badges"        && <ManualBadgeAssign staffPhone={user.numero_tel} staffId={user.id} />}
          {tab === "notifications" && <PushNotificationPanel staffId={user.id} pole={pole} />}

        </main>
      </div>
    </>
  );
}

// ─── Panel Billets ────────────────────────────────────────────────────────────

const GITHUB_TOKEN = process.env.NEXT_PUBLIC_GITHUB_TOKEN ?? "";
const GITHUB_REPO  = process.env.NEXT_PUBLIC_GITHUB_REPO ?? "";  // ex: "Vertocz/webapppole"

function BilletsPanel() {
  const [files,         setFiles]         = useState<UploadedFile[]>([]);
  const [dragging,      setDragging]      = useState(false);
  const [processing,    setProcessing]    = useState(false);
  const [processStatus, setProcessStatus] = useState<"idle" | "triggered" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingUploads = useRef(0);

  const triggerWorkflow = useCallback(async () => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return;
    setProcessing(true);
    setProcessStatus("idle");
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/process_billets.yml/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ref: "main" }),
        }
      );
      // 204 = déclenché avec succès
      setProcessStatus(res.status === 204 ? "triggered" : "error");
    } catch {
      setProcessStatus("error");
    } finally {
      setProcessing(false);
    }
  }, []);

  const uploadFile = useCallback(async (file: File, index: number) => {
    setFiles(prev => prev.map((f, i) => i === index ? { ...f, status: "uploading" } : f));

    const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await supabase.storage
      .from("Billets")
      .upload(safeName, file, { upsert: false });

    if (error) {
      setFiles(prev => prev.map((f, i) =>
        i === index ? { ...f, status: "error", error: error.message } : f
      ));
    } else {
      setFiles(prev => prev.map((f, i) =>
        i === index ? { ...f, status: "done" } : f
      ));
    }

    pendingUploads.current -= 1;
    if (pendingUploads.current === 0) {
      triggerWorkflow();
    }
  }, [triggerWorkflow]);

  const addFiles = useCallback((newFiles: File[]) => {
    const valid = newFiles.filter(f => f.type === "application/pdf" || f.name.endsWith(".pdf"));
    if (!valid.length) return;

    const startIndex = files.length;
    pendingUploads.current += valid.length;
    const entries: UploadedFile[] = valid.map(f => ({
      name: f.name, size: f.size, status: "pending",
    }));
    setFiles(prev => [...prev, ...entries]);
    valid.forEach((f, i) => uploadFile(f, startIndex + i));
  }, [files.length, uploadFile]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const statusIcon = (s: UploadedFile["status"]) => {
    if (s === "pending")   return <span className="text-xs" style={{ color: "var(--text-muted)" }}>⏳</span>;
    if (s === "uploading") return <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />;
    if (s === "done")      return <span className="text-green-400 text-sm">✓</span>;
    return <span className="text-red-400 text-sm">✗</span>;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
        <p className="text-xs uppercase tracking-widest font-medium mb-1" style={{ color: "var(--text-sub)" }}>
          Dépôt de billets
        </p>
        <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
          Les fichiers sont déposés dans le bucket Billets. L&apos;attribution aux joueurs se fait dans un second temps.
        </p>

        {/* Zone drag & drop */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer transition-all py-10"
          style={{
            border: `2px dashed ${dragging ? "var(--accent)" : "var(--border)"}`,
            background: dragging
              ? "color-mix(in srgb, var(--accent) 8%, var(--bg-input))"
              : "var(--bg-input)",
          }}>
          <span className="text-4xl">🎫</span>
          <div className="text-center">
            <p className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
              Glisser-déposer des PDF
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              ou appuyer pour sélectionner
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            className="hidden"
            onChange={e => addFiles(Array.from(e.target.files ?? []))}
          />
        </div>
      </div>

      {/* Statut traitement */}
      {(processing || processStatus !== "idle") && (
        <div className="rounded-xl px-4 py-3"
          style={{
            background: processing
              ? "rgba(59,130,246,0.08)"
              : processStatus === "triggered"
                ? "rgba(74,222,128,0.08)"
                : "rgba(248,113,113,0.08)",
            border: `1px solid ${processing
              ? "rgba(59,130,246,0.2)"
              : processStatus === "triggered"
                ? "rgba(74,222,128,0.2)"
                : "rgba(248,113,113,0.2)"}`,
          }}>
          {processing ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin shrink-0"
                style={{ borderColor: "#60a5fa", borderTopColor: "transparent" }} />
              <p className="text-sm" style={{ color: "#60a5fa" }}>
                Déclenchement du traitement…
              </p>
            </div>
          ) : processStatus === "triggered" ? (
            <div>
              <p className="text-sm font-medium" style={{ color: "#4ade80" }}>
                ✓ Traitement lancé
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                Le script tourne en arrière-plan (~1 min). Résultat visible dans GitHub Actions.
              </p>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "#f87171" }}>
              Erreur lors du déclenchement — vérifie le token GitHub.
            </p>
          )}
        </div>
      )}
      {files.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="px-4 py-2.5 flex items-center justify-between"
            style={{ background: "var(--bg-input)", borderBottom: "1px solid var(--border)" }}>
            <p className="text-xs uppercase tracking-widest font-medium" style={{ color: "var(--text-sub)" }}>
              Fichiers ({files.length})
            </p>
            <button onClick={() => setFiles([])}
              className="text-xs" style={{ color: "var(--text-muted)" }}>
              Tout effacer
            </button>
          </div>
          <div style={{ background: "var(--bg-card)" }}>
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3"
                style={{ borderBottom: i < files.length - 1 ? "1px solid var(--border)" : "none" }}>
                <span className="text-lg shrink-0">📄</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: "var(--text-main)" }}>{f.name}</p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{fmtSize(f.size)}</p>
                  {f.error && <p className="text-xs text-red-400 mt-0.5">{f.error}</p>}
                </div>
                <div className="shrink-0">{statusIcon(f.status)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Panel Joueurs ────────────────────────────────────────────────────────────

function JoueursPanel({ user }: { user: Staff }) {
  const [joueurs,  setJoueurs]  = useState<Joueuse[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [editId,   setEditId]   = useState<string | null>(null);
  const [editData, setEditData] = useState({ prenom: "", nom: "", numero_tel: "", categorie: "" });
  const [adding,   setAdding]   = useState(false);
  const [newData,  setNewData]  = useState({ prenom: "", nom: "", numero_tel: "", categorie: "" });
  const [saving,   setSaving]   = useState(false);
  const [confirm,  setConfirm]  = useState<ConfirmModal | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const pole: "masculin" | "feminin" | "both" =
    user.masculin && user.feminin ? "both" : user.masculin ? "masculin" : "feminin";

  const loadJoueurs = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("joueuses").select("id, prenom, nom, numero_tel, categorie");
    if (pole === "masculin") q = q.eq("categorie", "Masculin");
    else if (pole === "feminin") q = q.eq("categorie", "Féminin");
    const { data } = await q.order("prenom", { ascending: true });
    setJoueurs(data ?? []);
    setLoading(false);
  }, [pole]);

  useEffect(() => { loadJoueurs(); }, [loadJoueurs]);

  const showFeedback = (type: "success" | "error", msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 3000);
  };

  // ── Ajout ──────────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!newData.prenom.trim() || !newData.nom.trim()) return;
    setSaving(true);
    const categorie = pole === "feminin" ? "Féminin" : pole === "masculin" ? "Masculin" : newData.categorie;
    const { error } = await supabase.from("joueuses").insert({
      prenom: newData.prenom.trim(),
      nom: newData.nom.trim(),
      numero_tel: newData.numero_tel.trim() || null,
      categorie,
    });
    setSaving(false);
    if (error) { showFeedback("error", "Erreur lors de l'ajout."); return; }
    setAdding(false);
    setNewData({ prenom: "", nom: "", numero_tel: "", categorie: "" });
    showFeedback("success", "Joueur ajouté.");
    loadJoueurs();
  };

  // ── Modification ───────────────────────────────────────────────────────────
  const startEdit = (j: Joueuse) => {
    setEditId(j.id);
    setEditData({ prenom: j.prenom, nom: j.nom, numero_tel: j.numero_tel ?? "", categorie: j.categorie ?? "" });
  };

  const handleSave = (j: Joueuse) => {
    setConfirm({
      title: "Modifier le joueur",
      message: `Confirmer les modifications pour ${j.prenom} ${j.nom} ?`,
      onConfirm: async () => {
        setConfirm(null);
        setSaving(true);
        const { error } = await supabase.from("joueuses").update({
          prenom: editData.prenom.trim(),
          nom: editData.nom.trim(),
          numero_tel: editData.numero_tel.trim() || null,
          categorie: editData.categorie,
        }).eq("id", j.id);
        setSaving(false);
        if (error) { showFeedback("error", "Erreur lors de la modification."); return; }
        setEditId(null);
        showFeedback("success", "Joueur modifié.");
        loadJoueurs();
      },
    });
  };

  // ── Suppression ────────────────────────────────────────────────────────────
  const handleDelete = (j: Joueuse) => {
    setConfirm({
      title: "Supprimer le joueur",
      message: `Supprimer définitivement ${j.prenom} ${j.nom} ? Cette action est irréversible.`,
      onConfirm: async () => {
        setConfirm(null);
        const { error } = await supabase.from("joueuses").delete().eq("id", j.id);
        if (error) { showFeedback("error", "Erreur lors de la suppression."); return; }
        showFeedback("success", "Joueur supprimé.");
        loadJoueurs();
      },
    });
  };

  const inputStyle = {
    background: "var(--bg-input)",
    border: "1px solid var(--border)",
    color: "var(--text-main)",
    borderRadius: "0.5rem",
    padding: "0.375rem 0.625rem",
    fontSize: "0.8125rem",
    width: "100%",
    outline: "none",
  };

  return (
    <>
      <div className="space-y-4">

        {/* Feedback */}
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

        {/* Header + bouton ajouter */}
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-widest font-medium" style={{ color: "var(--text-sub)" }}>
            {joueurs.length} joueur{joueurs.length > 1 ? "s" : ""}
            {pole !== "both" && ` — Pôle ${pole === "masculin" ? "Masculin" : "Féminin"}`}
          </p>
          <button
            onClick={() => { setAdding(true); setEditId(null); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all active:scale-95"
            style={{
              background: "linear-gradient(135deg,var(--accent),var(--accent2))",
              color: "white",
              boxShadow: "0 2px 8px var(--accent-glow)",
            }}>
            <span>+</span><span>Ajouter</span>
          </button>
        </div>

        {/* Formulaire ajout */}
        {adding && (
          <div className="rounded-xl p-4 space-y-3"
            style={{ background: "var(--bg-card)", border: "1px solid color-mix(in srgb,var(--accent) 30%,transparent)" }}>
            <p className="text-xs uppercase tracking-widest font-medium" style={{ color: "var(--accent)" }}>
              Nouveau joueur
            </p>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Prénom *" value={newData.prenom}
                onChange={e => setNewData(d => ({ ...d, prenom: e.target.value }))}
                style={inputStyle} />
              <input placeholder="Nom *" value={newData.nom}
                onChange={e => setNewData(d => ({ ...d, nom: e.target.value }))}
                style={inputStyle} />
            </div>
            <input placeholder="Téléphone" value={newData.numero_tel}
              onChange={e => setNewData(d => ({ ...d, numero_tel: e.target.value }))}
              style={inputStyle} />
            {/* Sélecteur pôle seulement si staff both */}
            {pole === "both" && (
              <select value={newData.categorie}
                onChange={e => setNewData(d => ({ ...d, categorie: e.target.value }))}
                style={inputStyle}>
                <option value="">Choisir le pôle *</option>
                <option value="Masculin">Pôle Masculin</option>
                <option value="Féminin">Pôle Féminin</option>
              </select>
            )}
            <div className="flex gap-2">
              <button onClick={handleAdd} disabled={saving || !newData.prenom.trim() || !newData.nom.trim()}
                className="flex-1 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40"
                style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}>
                {saving ? "Ajout…" : "Confirmer"}
              </button>
              <button onClick={() => setAdding(false)}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* Liste */}
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "var(--spinner)", borderTopColor: "transparent" }} />
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
            {joueurs.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>
                Aucun joueur dans ce périmètre
              </p>
            ) : joueurs.map((j, i) => (
              <div key={j.id} style={{
                background: editId === j.id ? "color-mix(in srgb,var(--accent) 5%,var(--bg-card))" : "var(--bg-card)",
                borderBottom: i < joueurs.length - 1 ? "1px solid var(--border)" : "none",
              }}>
                {editId === j.id ? (
                  // ── Mode édition ──
                  <div className="p-4 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input value={editData.prenom}
                        onChange={e => setEditData(d => ({ ...d, prenom: e.target.value }))}
                        style={inputStyle} />
                      <input value={editData.nom}
                        onChange={e => setEditData(d => ({ ...d, nom: e.target.value }))}
                        style={inputStyle} />
                    </div>
                    <input value={editData.numero_tel}
                      onChange={e => setEditData(d => ({ ...d, numero_tel: e.target.value }))}
                      placeholder="Téléphone"
                      style={inputStyle} />
                    {pole === "both" && (
                      <select value={editData.categorie}
                        onChange={e => setEditData(d => ({ ...d, categorie: e.target.value }))}
                        style={inputStyle}>
                        <option value="Masculin">Pôle Masculin</option>
                        <option value="Féminin">Pôle Féminin</option>
                      </select>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => handleSave(j)} disabled={saving}
                        className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                        style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}>
                        Enregistrer
                      </button>
                      <button onClick={() => setEditId(null)}
                        className="px-3 py-1.5 rounded-lg text-xs"
                        style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : (
                  // ── Mode lecture ──
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
                        {j.prenom} {j.nom}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {j.numero_tel && (
                          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{j.numero_tel}</p>
                        )}
                        {j.categorie && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                            style={{
                              background: j.categorie === "Masculin" ? "rgba(59,130,246,0.12)" : "rgba(236,72,153,0.12)",
                              color: j.categorie === "Masculin" ? "#60a5fa" : "#f472b6",
                            }}>
                            {j.categorie === "Masculin" ? "M" : "F"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => startEdit(j)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all hover:opacity-80"
                        style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}
                        title="Modifier">
                        ✏️
                      </button>
                      <button onClick={() => handleDelete(j)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all hover:opacity-80"
                        style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}
                        title="Supprimer">
                        🗑️
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de confirmation */}
      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
    </>
  );
}

// ─── Modal de confirmation ────────────────────────────────────────────────────

function ConfirmDialog({ title, message, onConfirm, onCancel }: ConfirmModal & { onCancel: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-[400]"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }} />
      <div className="fixed inset-0 z-[401] flex items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl overflow-hidden"
          style={{
            background: "linear-gradient(145deg,#0B1120,#0E1E38)",
            border: "1px solid rgba(43,80,160,0.35)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            animation: "notifSlideUp .25s cubic-bezier(.32,.72,0,1) forwards",
          }}>
          <div className="h-1" style={{ background: "linear-gradient(90deg,transparent,#1B3A8C,#C49A28,transparent)" }} />
          <div className="p-6">
            <p className="font-display text-base tracking-wider mb-2" style={{ color: "var(--text-main)" }}>
              {title.toUpperCase()}
            </p>
            <p className="text-sm leading-relaxed mb-6" style={{ color: "var(--text-muted)" }}>
              {message}
            </p>
            <div className="flex gap-2">
              <button onClick={onConfirm}
                className="flex-1 py-3 rounded-xl text-sm font-display tracking-widest transition-all active:scale-95"
                style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}>
                CONFIRMER
              </button>
              <button onClick={onCancel}
                className="px-4 py-3 rounded-xl text-sm font-medium"
                style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes notifSlideUp {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </>
  );
}