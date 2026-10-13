"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

interface Props {
  onScan: (data: string) => void;
  onCancel: () => void;
}

type Status = "loading" | "scanning" | "error";

function describeError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Accès à la caméra refusé. Autorise la caméra pour ce site dans les réglages de ton navigateur, puis réessaie.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Aucune caméra détectée sur cet appareil.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "La caméra est déjà utilisée par une autre application. Ferme-la et réessaie.";
  }
  if (name === "OverconstrainedError") {
    return "Aucune caméra ne correspond aux réglages demandés.";
  }
  return "Impossible d'accéder à la caméra. Vérifie les autorisations.";
}

export default function QRScanner({ onScan, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");

  // Évite de rouvrir la caméra à chaque re-rendu du parent : onScan est
  // recréée à chaque rendu de RoomConnect, et sans cette ref l'effet
  // ci-dessous se relancerait (coupant puis rouvrant le flux vidéo) à
  // chaque changement d'état ailleurs dans l'arbre des composants.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.isSecureContext) {
      setStatus("error");
      setError("L'accès à la caméra nécessite une connexion sécurisée (https). Vérifie l'adresse du site.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError("Ce navigateur ne permet pas d'accéder à la caméra.");
      return;
    }

    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus("scanning");
        tick();
      } catch (err) {
        if (stopped) return;
        setStatus("error");
        setError(describeError(err));
      }
    }

    function tick() {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code?.data) {
            stopped = true;
            onScanRef.current(code.data);
            return;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    }

    start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl overflow-hidden relative" style={{ border: "1px solid var(--border)", minHeight: 180 }}>
        <video ref={videoRef} muted playsInline className="w-full block" />
        {status === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ background: "var(--bg-input)" }}>
            <div
              className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
            />
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Ouverture de la caméra…
            </p>
          </div>
        )}
        {status === "scanning" && (
          <div
            className="absolute inset-8 rounded-xl pointer-events-none"
            style={{ border: "2px solid var(--accent)", opacity: 0.6 }}
          />
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      {error && (
        <p className="text-sm" style={{ color: "#f87171" }}>
          {error}
        </p>
      )}
      <button
        onClick={onCancel}
        className="w-full py-2.5 rounded-xl text-sm font-medium"
        style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
      >
        Annuler
      </button>
    </div>
  );
}
