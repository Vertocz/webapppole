"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

interface Props {
  onScan: (data: string) => void;
  onCancel: () => void;
}

function cameraErrorMessage(e: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "La caméra exige une connexion sécurisée (HTTPS). Ouvre le site en https://.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "Ce navigateur ne permet pas d'accéder à la caméra. Essaie Chrome ou Safari à jour.";
  }
  const name = (e as { name?: string })?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Accès à la caméra refusé. Autorise la caméra pour ce site dans les réglages du navigateur, puis réessaie.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Aucune caméra détectée sur cet appareil.";
    case "NotReadableError":
    case "AbortError":
      return "La caméra est utilisée par une autre application. Ferme-la et réessaie.";
    default:
      return `Impossible d'ouvrir la caméra${name ? ` (${name})` : ""}.`;
  }
}

export default function QRScanner({ onScan, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Ouverture de la caméra…");

  // Garde toujours la dernière version de onScan SANS relancer la caméra
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let lastScan = 0;

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          });
        } catch (e) {
          // Repli : n'importe quelle caméra
          if ((e as { name?: string })?.name === "OverconstrainedError") {
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
          } else {
            throw e;
          }
        }
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        setStatus("Caméra active — cadre le QR code, bien net et en entier.");
        tick();
      } catch (e) {
        setStatus("");
        setError(cameraErrorMessage(e));
      }
    }

    function tick() {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const now = performance.now();
      // ~8 analyses/s : jsQR est lourd, inutile de le lancer à chaque frame
      if (
        video &&
        canvas &&
        video.readyState === video.HAVE_ENOUGH_DATA &&
        now - lastScan > 120
      ) {
        lastScan = now;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });
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
      <div className="rounded-2xl overflow-hidden relative" style={{ border: "1px solid var(--border)" }}>
        <video ref={videoRef} muted playsInline className="w-full block" />
        <div
          className="absolute inset-8 rounded-xl pointer-events-none"
          style={{ border: "2px solid var(--accent)", opacity: 0.6 }}
        />
      </div>
      <canvas ref={canvasRef} className="hidden" />
      {status && !error && (
        <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
          {status}
        </p>
      )}
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
