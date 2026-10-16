"use client";

import { useEffect, useState } from "react";
import {
  RARETE_COLOR,
  RARETE_LABEL,
  getCarteUrl,
  getPersonne,
  type Rarete,
} from "@/lib/victorinis";

interface Props {
  personne: string;
  rarete: Rarete;
  /** true = carte tout juste gagnée (animation + message), false = simple aperçu depuis la collection */
  gagnee?: boolean;
  onClose: () => void;
}

const PARTICULES = Array.from({ length: 16 }, (_, i) => ({
  left: `${(i * 37 + 11) % 100}%`,
  delay: `${((i * 53) % 20) / 10}s`,
  duration: `${2.4 + ((i * 17) % 15) / 10}s`,
  size: 10 + ((i * 7) % 12),
}));

export default function CarteModal({ personne, rarete, gagnee = true, onClose }: Props) {
  const [imageChargee, setImageChargee] = useState(false);
  const [delaiPasse, setDelaiPasse] = useState(!gagnee);
  const revele = imageChargee && delaiPasse;

  const color = RARETE_COLOR[rarete];
  const p = getPersonne(personne);
  const url = getCarteUrl(personne, rarete);

  useEffect(() => {
    const img = new window.Image();
    img.onload = () => setImageChargee(true);
    img.onerror = () => setImageChargee(true); // on ne bloque jamais la modale
    img.src = url;
  }, [url]);

  useEffect(() => {
    if (!gagnee) return;
    const t = setTimeout(() => setDelaiPasse(true), 900);
    return () => clearTimeout(t);
  }, [gagnee]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const glow =
    rarete === "or"
      ? "0 0 60px 12px rgba(242,185,15,0.55), 0 0 120px 30px rgba(242,185,15,0.25)"
      : rarete === "argent"
      ? "0 0 40px 6px rgba(201,209,222,0.4)"
      : "0 0 40px 6px rgba(59,123,255,0.4)";

  const titre = gagnee
    ? "Tu viens de gagner une carte"
    : `${p?.prenom ?? ""} ${p?.nom ?? ""}`.trim();

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <style>{`
        @keyframes vic-fadein { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes vic-pulse { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.12); } }
        @keyframes vic-shine { 0% { transform: translateX(-130%) skewX(-20deg); } 55%,100% { transform: translateX(230%) skewX(-20deg); } }
        @keyframes vic-float { 0% { transform: translateY(0) scale(0.6); opacity: 0; } 15% { opacity: 1; } 100% { transform: translateY(-110vh) scale(1.1); opacity: 0; } }
      `}</style>

      {/* Croix de fermeture */}
      <button
        onClick={onClose}
        aria-label="Fermer"
        className="absolute top-4 right-4 w-11 h-11 rounded-full flex items-center justify-center text-xl transition-all active:scale-90"
        style={{ background: "rgba(255,255,255,0.12)", color: "white", border: "1px solid rgba(255,255,255,0.2)" }}
      >
        ✕
      </button>

      {/* Particules dorées */}
      {rarete === "or" && revele && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {PARTICULES.map((pt, i) => (
            <span
              key={i}
              className="absolute bottom-0"
              style={{
                left: pt.left,
                fontSize: pt.size,
                color: "#F2B90F",
                animation: `vic-float ${pt.duration} ${pt.delay} infinite ease-out`,
              }}
            >
              ✦
            </span>
          ))}
        </div>
      )}

      {/* Message */}
      <div
        className="text-center mb-5 min-h-[3.5rem]"
        style={{ opacity: revele ? 1 : 0, animation: revele ? "vic-fadein 0.5s ease both" : undefined }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-display text-xl" style={{ color: "#E8EEF8" }}>
          {titre}
          {gagnee && (
            <>
              {" "}
              <span style={{ color }}>{RARETE_LABEL[rarete]}</span> !
            </>
          )}
        </p>
        {!gagnee && (
          <p className="text-xs uppercase tracking-widest mt-1" style={{ color }}>
            Carte {RARETE_LABEL[rarete]}
          </p>
        )}
      </div>

      {/* Carte qui se retourne */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ perspective: 1200, width: "min(72vw, 300px)", aspectRatio: "2 / 3" }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            transformStyle: "preserve-3d",
            transition: gagnee ? "transform 0.9s cubic-bezier(.2,.8,.2,1)" : "none",
            transform: revele ? "rotateY(0deg)" : "rotateY(180deg)",
          }}
        >
          {/* Face avant */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backfaceVisibility: "hidden",
              borderRadius: 18,
              overflow: "hidden",
              boxShadow: revele ? glow : "none",
              animation: revele && rarete !== "bleu" ? "vic-pulse 2.2s ease-in-out infinite" : undefined,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Carte ${p?.prenom ?? ""} ${p?.nom ?? ""}`} className="w-full h-full object-cover" />
            {rarete !== "bleu" && revele && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    width: "40%",
                    background: `linear-gradient(90deg, transparent, ${
                      rarete === "or" ? "rgba(255,240,170,0.55)" : "rgba(255,255,255,0.4)"
                    }, transparent)`,
                    animation: "vic-shine 2.8s ease-in-out infinite",
                  }}
                />
              </div>
            )}
          </div>

          {/* Dos de carte */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
              borderRadius: 18,
              background: "linear-gradient(145deg, #0B1120, #1B3A8C 60%, #0E1E38)",
              border: "2px solid rgba(255,255,255,0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 64,
              color: "rgba(255,255,255,0.85)",
            }}
          >
            🏀
          </div>
        </div>
      </div>
    </div>
  );
}
