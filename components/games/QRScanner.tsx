"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

interface Props {
  onScan: (data: string) => void;
  onCancel: () => void;
}

export default function QRScanner({ onScan, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        tick();
      } catch {
        setError("Impossible d'accéder à la caméra. Vérifie les autorisations.");
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
            onScan(code.data);
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
  }, [onScan]);

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
