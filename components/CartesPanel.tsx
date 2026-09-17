"use client";

import { useCallback, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

interface UploadedFile {
  name: string;
  size: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

const GITHUB_TOKEN = process.env.NEXT_PUBLIC_GITHUB_TOKEN ?? "";
const GITHUB_REPO = process.env.NEXT_PUBLIC_GITHUB_REPO ?? "";

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function CartesPanel() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState<"idle" | "triggered" | "error">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingUploads = useRef(0);

  const triggerWorkflow = useCallback(async () => {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return;
    setProcessing(true);
    setProcessStatus("idle");
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/process_cartes.yml/dispatches`,
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
      setProcessStatus(res.status === 204 ? "triggered" : "error");
    } catch {
      setProcessStatus("error");
    } finally {
      setProcessing(false);
    }
  }, []);

  const uploadFile = useCallback(
    async (file: File, index: number) => {
      setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: "uploading" } : f)));

      const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await supabase.storage.from("cartes").upload(safeName, file, { upsert: false });

      if (error) {
        setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: "error", error: error.message } : f)));
      } else {
        setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, status: "done" } : f)));
      }

      pendingUploads.current -= 1;
      if (pendingUploads.current === 0) triggerWorkflow();
    },
    [triggerWorkflow]
  );

  const addFiles = useCallback(
    (newFiles: File[]) => {
      const valid = newFiles.filter((f) => f.type === "application/pdf" || f.name.endsWith(".pdf"));
      if (!valid.length) return;
      const startIndex = files.length;
      pendingUploads.current += valid.length;
      const entries: UploadedFile[] = valid.map((f) => ({ name: f.name, size: f.size, status: "pending" }));
      setFiles((prev) => [...prev, ...entries]);
      valid.forEach((f, i) => uploadFile(f, startIndex + i));
    },
    [files.length, uploadFile]
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const statusIcon = (s: UploadedFile["status"]) => {
    if (s === "pending")
      return (
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          ⏳
        </span>
      );
    if (s === "uploading")
      return (
        <div
          className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
        />
      );
    if (s === "done") return <span className="text-green-400 text-sm">✓</span>;
    return <span className="text-red-400 text-sm">✗</span>;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
        <p className="text-xs uppercase tracking-widest font-medium mb-1" style={{ color: "var(--text-sub)" }}>
          Cartes avantage SNCF
        </p>
        <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
          Dépose les PDF ici pour les associer automatiquement au bon joueur ou
          membre du staff, par correspondance de nom. Un traitement se lance
          aussi manuellement ci-dessous — utile si des cartes ont été ajoutées
          directement dans le stockage.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer transition-all py-10"
          style={{
            border: `2px dashed ${dragging ? "var(--accent)" : "var(--border)"}`,
            background: dragging ? "color-mix(in srgb, var(--accent) 8%, var(--bg-input))" : "var(--bg-input)",
          }}
        >
          <span className="text-4xl">💳</span>
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
            onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
          />
        </div>

        <button
          onClick={triggerWorkflow}
          disabled={processing}
          className="w-full mt-4 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
          style={{ border: "1px solid var(--border)", color: "var(--text-main)" }}
        >
          🔄 Relancer le traitement (cartes déjà dans le stockage)
        </button>
      </div>

      {(processing || processStatus !== "idle") && (
        <div
          className="rounded-xl px-4 py-3"
          style={{
            background: processing
              ? "rgba(59,130,246,0.08)"
              : processStatus === "triggered"
              ? "rgba(74,222,128,0.08)"
              : "rgba(248,113,113,0.08)",
            border: `1px solid ${
              processing
                ? "rgba(59,130,246,0.2)"
                : processStatus === "triggered"
                ? "rgba(74,222,128,0.2)"
                : "rgba(248,113,113,0.2)"
            }`,
          }}
        >
          {processing ? (
            <div className="flex items-center gap-2">
              <div
                className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin shrink-0"
                style={{ borderColor: "#60a5fa", borderTopColor: "transparent" }}
              />
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
                Résultat visible dans l&apos;onglet GitHub Actions du dépôt (~1 min).
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
          <div
            className="px-4 py-2.5 flex items-center justify-between"
            style={{ background: "var(--bg-input)", borderBottom: "1px solid var(--border)" }}
          >
            <p className="text-xs uppercase tracking-widest font-medium" style={{ color: "var(--text-sub)" }}>
              Fichiers ({files.length})
            </p>
            <button onClick={() => setFiles([])} className="text-xs" style={{ color: "var(--text-muted)" }}>
              Tout effacer
            </button>
          </div>
          <div style={{ background: "var(--bg-card)" }}>
            {files.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-4 py-3"
                style={{ borderBottom: i < files.length - 1 ? "1px solid var(--border)" : "none" }}
              >
                <span className="text-lg shrink-0">💳</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: "var(--text-main)" }}>
                    {f.name}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {fmtSize(f.size)}
                  </p>
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
