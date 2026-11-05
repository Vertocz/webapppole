"use client";

// Demi-terrain FIBA 3x3 en SVG (panier en haut, vu depuis le milieu du terrain).
// Les enfants sont dessinés dans le repère du terrain : utiliser tx(x) et y directement.

import { useRef } from "react";
import { ARC_JONCTION_Y, TERRAIN } from "@/lib/analyse";

/** Abscisse SVG d'un point du terrain (x de -7,5 à 7,5 m). */
export const tx = (x: number) => x + 7.5;

const T = TERRAIN;
const ARC_PATH = `M${tx(-T.arcX)} 0 L${tx(-T.arcX)} ${ARC_JONCTION_Y} A${T.rayonArc} ${T.rayonArc} 0 0 0 ${tx(T.arcX)} ${ARC_JONCTION_Y} L${tx(T.arcX)} 0`;

export default function Terrain({
  children,
  onClickTerrain,
  ligne = "var(--text-muted)",
  fond = "color-mix(in srgb, var(--primary) 18%, var(--bg-input))",
  accent = "var(--accent)",
  className = "",
  style,
}: {
  children?: React.ReactNode;
  /** Clic sur le terrain, en mètres (repère de lib/analyse) */
  onClickTerrain?: (x: number, y: number) => void;
  ligne?: string;
  fond?: string;
  accent?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<SVGSVGElement>(null);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onClickTerrain || !ref.current) return;
    const ctm = ref.current.getScreenCTM();
    if (!ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const x = Math.max(-7.5, Math.min(7.5, p.x - 7.5));
    const y = Math.max(0, Math.min(11, p.y));
    onClickTerrain(x, y);
  };

  return (
    <svg
      ref={ref}
      viewBox="-0.4 -0.4 15.8 11.8"
      className={className}
      style={{ display: "block", width: "100%", height: "auto", cursor: onClickTerrain ? "crosshair" : "default", ...style }}
      onClick={handleClick}
      role={onClickTerrain ? "button" : "img"}
      aria-label="Demi-terrain de basket 3x3"
    >
      <rect x={0} y={0} width={15} height={11} fill={fond} rx={0.15} />
      <g fill="none" stroke={ligne} strokeWidth={0.07} strokeLinejoin="round">
        <rect x={0} y={0} width={15} height={11} />
        <rect x={tx(-T.raquetteDemiLargeur)} y={0} width={T.raquetteDemiLargeur * 2} height={T.ligneLF} />
        <path d={`M${tx(-T.rayonLF)} ${T.ligneLF} A${T.rayonLF} ${T.rayonLF} 0 0 0 ${tx(T.rayonLF)} ${T.ligneLF}`} />
        <path d={ARC_PATH} />
        <path
          d={`M${tx(-T.rayonNonCharge)} ${T.panierY} A${T.rayonNonCharge} ${T.rayonNonCharge} 0 0 0 ${tx(T.rayonNonCharge)} ${T.panierY}`}
          strokeDasharray="0.15 0.12"
        />
        <line x1={tx(-0.9)} y1={T.planche} x2={tx(0.9)} y2={T.planche} strokeWidth={0.12} />
        <circle cx={tx(0)} cy={T.panierY} r={0.23} stroke={accent} strokeWidth={0.08} />
      </g>
      {children}
    </svg>
  );
}
