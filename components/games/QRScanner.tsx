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
        // Sans résolution demandée, beaucoup de téléphones filment en 640×480 : un QR y est
        // représenté par trop peu de pixels pour être lu. On demande la meilleure définition.
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        try {
          // Mise au point continue quand le navigateur la propose (sinon le QR reste flou de près).
          const track = stream.getVideoTracks()[0];
          await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] });
        } catch {
          /* non supporté : sans conséquence */
        }
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

    // Lecteur natif du navigateur quand il existe (bien plus tolérant que jsQR), sinon jsQR.
    type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    let detector: Detector | null = null;
    try {
      detector = BD ? new BD({ formats: ["qr_code"] }) : null;
    } catch {
      detector = null;
    }
    let busy = false;
    let lastTry = 0;

    function found(text: string) {
      stopped = true;
      onScanRef.current(text);
    }

    async function tryFrame(video: HTMLVideoElement) {
      busy = true;
      try {
        if (detector) {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) return found(codes[0].rawValue);
        }
        // jsQR : en plus du lecteur natif s'il n'a rien vu (ou à sa place s'il n'existe pas)
        const canvas = canvasRef.current;
        if (canvas && video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
            if (code?.data) return found(code.data);
          }
        }
      } catch {
        /* image illisible : on réessaie à la prochaine */
      } finally {
        busy = false;
      }
    }

    function tick(now = performance.now()) {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState === video.HAVE_ENOUGH_DATA && !busy && now - lastTry > 110) {
        lastTry = now;
        void tryFrame(video);
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
      {status === "scanning" && (
        <p className="text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
          Cadre tout le QR, à 20-30 cm, sans bouger. S&apos;il reste flou, recule un peu.
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
