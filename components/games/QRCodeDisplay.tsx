"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

/**
 * Affiche un QR code net : chaque module fait un nombre ENTIER de pixels d'écran
 * (pas de flou de redimensionnement), avec la marge blanche réglementaire de 4 modules
 * (une marge trop courte est une cause fréquente d'échec de lecture).
 */
export default function QRCodeDisplay({ data, size = 440 }: { data: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const qr = QRCode.create(data, { errorCorrectionLevel: "L" });
      const n = qr.modules.size;
      const margin = 4;
      const total = n + margin * 2;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const target = Math.min(size, window.innerWidth - 32);
      const scale = Math.max(2, Math.floor((target * dpr) / total));
      canvas.width = total * scale;
      canvas.height = total * scale;
      canvas.style.width = `${canvas.width / dpr}px`;
      canvas.style.height = `${canvas.height / dpr}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#000";
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (qr.modules.get(r, c)) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
        }
      }
      setError(false);
    } catch {
      setError(true);
    }
  }, [data, size]);

  if (error) {
    return (
      <p className="text-xs text-center" style={{ color: "#f87171" }}>
        Impossible de générer le QR (donnée trop volumineuse).
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <canvas ref={canvasRef} className="mx-auto block rounded-xl" style={{ background: "white", imageRendering: "pixelated" }} />
      <p className="text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
        Mets la luminosité de cet écran au maximum.
      </p>
    </div>
  );
}
