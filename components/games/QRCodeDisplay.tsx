"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

export default function QRCodeDisplay({ data, size = 240 }: { data: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    setError(false);
    QRCode.toCanvas(canvasRef.current, data, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "L",
    }).catch(() => setError(true));
  }, [data, size]);

  if (error) {
    return (
      <p className="text-xs text-center" style={{ color: "#f87171" }}>
        Impossible de générer le QR (donnée trop volumineuse).
      </p>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="rounded-xl"
      style={{ background: "white", width: size, height: size }}
    />
  );
}
