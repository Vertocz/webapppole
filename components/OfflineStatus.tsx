"use client";

// Bandeau global du mode hors ligne + démarrage de la synchronisation.
// Monté une seule fois dans app/layout.tsx.

import { useEffect, useState } from "react";
import { discardFailedOps, flushOutbox, startOfflineSync, useOnline, useOutboxCount } from "@/lib/offline";

export default function OfflineStatus() {
  const online = useOnline();
  const { pending, failed } = useOutboxCount();
  const [justBackOnline, setJustBackOnline] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => startOfflineSync(), []);

  useEffect(() => {
    if (!online) { setWasOffline(true); return; }
    if (wasOffline) {
      setWasOffline(false);
      setJustBackOnline(true);
      const t = setTimeout(() => setJustBackOnline(false), 3000);
      return () => clearTimeout(t);
    }
  }, [online, wasOffline]);

  let content: React.ReactNode = null;
  let tone: "warn" | "ok" | "error" = "warn";

  if (!online) {
    content = (
      <>
        <span>📡 Hors ligne</span>
        <span className="opacity-80">
          {pending > 0
            ? ` · ${pending} enregistrement${pending > 1 ? "s" : ""} en attente`
            : " · données de ta dernière connexion"}
        </span>
      </>
    );
  } else if (failed > 0) {
    tone = "error";
    content = (
      <>
        <span>⚠️ {failed} enregistrement{failed > 1 ? "s" : ""} refusé{failed > 1 ? "s" : ""} par le serveur</span>
        <button onClick={() => flushOutbox()} className="underline ml-2">Réessayer</button>
        <button onClick={() => discardFailedOps()} className="underline ml-2 opacity-80">Ignorer</button>
      </>
    );
  } else if (pending > 0) {
    content = <span>⏳ Envoi de {pending} enregistrement{pending > 1 ? "s" : ""}…</span>;
  } else if (justBackOnline) {
    tone = "ok";
    content = <span>✅ De nouveau en ligne</span>;
  }

  if (!content) return null;

  const colors = {
    warn: { background: "rgba(40,28,6,0.92)", border: "1px solid rgba(232,160,25,0.4)", color: "#F2C46D" },
    ok: { background: "rgba(6,32,16,0.92)", border: "1px solid rgba(34,197,94,0.4)", color: "#86efac" },
    error: { background: "rgba(40,8,10,0.92)", border: "1px solid rgba(239,68,68,0.4)", color: "#fca5a5" },
  }[tone];

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-full text-xs font-medium shadow-lg backdrop-blur max-w-[calc(100vw-32px)] text-center"
      style={{ ...colors, bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
    >
      {content}
    </div>
  );
}
