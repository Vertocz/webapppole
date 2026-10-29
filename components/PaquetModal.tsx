"use client";

import { useEffect, useState } from "react";
import CarteModal from "@/components/CarteModal";
import {
  RARETE_COLOR,
  RARETE_LABEL,
  getCarteUrl,
  getPersonne,
  type CarteGagnee,
} from "@/lib/victorinis";

/** Révélation d'un paquet de 3 cartes : elles se retournent l'une après l'autre. */
export default function PaquetModal({
  cartes,
  onClose,
}: {
  cartes: CarteGagnee[];
  onClose: () => void;
}) {
  const [pretes, setPretes] = useState(false);
  const [reveles, setReveles] = useState(0);
  const [ratio, setRatio] = useState(2 / 3);
  const [zoom, setZoom] = useState<CarteGagnee | null>(null);

  // On attend que les 3 images soient chargées avant de commencer
  useEffect(() => {
    let restantes = cartes.length;
    const fini = () => {
      restantes -= 1;
      if (restantes <= 0) setPretes(true);
    };
    cartes.forEach((c, i) => {
      const img = new window.Image();
      img.onload = () => {
        if (i === 0 && img.naturalWidth && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight);
        fini();
      };
      img.onerror = fini;
      img.src = getCarteUrl(c.personne, c.rarete);
    });
  }, [cartes]);

  useEffect(() => {
    if (!pretes) return;
    const timers = cartes.map((_, i) => setTimeout(() => setReveles(i + 1), 500 + i * 900));
    return () => timers.forEach(clearTimeout);
  }, [pretes, cartes]);

  const toutRevele = reveles >= cartes.length;
  const largeur = "min(29vw, 150px)";

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center px-3"
      style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Fermer"
        className="absolute top-4 right-4 w-11 h-11 rounded-full flex items-center justify-center text-xl"
        style={{ background: "rgba(255,255,255,0.12)", color: "white", border: "1px solid rgba(255,255,255,0.2)" }}
      >
        ✕
      </button>

      <p className="font-display text-xl text-center mb-6" style={{ color: "#E8EEF8" }}>
        {toutRevele ? "Tu as gagné 3 cartes !" : "Ouverture du paquet…"}
      </p>

      <div className="flex gap-2 justify-center" onClick={(e) => e.stopPropagation()} style={{ perspective: 1200 }}>
        {cartes.map((c, i) => {
          const montree = i < reveles;
          const color = RARETE_COLOR[c.rarete];
          const p = getPersonne(c.personne);
          const glow =
            c.rarete === "or"
              ? "0 0 28px 6px rgba(242,185,15,0.6)"
              : c.rarete === "argent"
              ? "0 0 18px 3px rgba(201,209,222,0.45)"
              : "0 0 18px 3px rgba(59,123,255,0.45)";
          return (
            <div key={i} className="flex flex-col items-center gap-2" style={{ width: largeur }}>
              <button
                onClick={() => montree && setZoom(c)}
                aria-label={`${p?.prenom ?? ""} ${p?.nom ?? ""}, carte ${RARETE_LABEL[c.rarete]}`}
                style={{ width: "100%", aspectRatio: `${ratio}`, position: "relative", transformStyle: "preserve-3d" }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    transformStyle: "preserve-3d",
                    transition: "transform 0.8s cubic-bezier(.2,.8,.2,1)",
                    transform: montree ? "rotateY(0deg)" : "rotateY(180deg)",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      backfaceVisibility: "hidden",
                      borderRadius: 10,
                      overflow: "hidden",
                      boxShadow: montree ? glow : "none",
                    }}
                  >
                    <img
                      src={getCarteUrl(c.personne, c.rarete)}
                      alt=""
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      backfaceVisibility: "hidden",
                      transform: "rotateY(180deg)",
                      borderRadius: 10,
                      background: "linear-gradient(145deg, #0B1120, #1B3A8C 60%, #0E1E38)",
                      border: "2px solid rgba(255,255,255,0.25)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 34,
                    }}
                  >
                    🏀
                  </div>
                </div>
              </button>
              <p
                className="text-[11px] uppercase tracking-widest"
                style={{ color, opacity: montree ? 1 : 0, transition: "opacity .4s .5s" }}
              >
                {c.rarete === "bleu" ? "Bleue" : RARETE_LABEL[c.rarete]}
              </p>
            </div>
          );
        })}
      </div>

      {toutRevele && (
        <p className="text-xs mt-5" style={{ color: "rgba(255,255,255,0.55)" }}>
          Touche une carte pour l&apos;agrandir
        </p>
      )}

      {zoom && (
        <CarteModal personne={zoom.personne} rarete={zoom.rarete} gagnee={false} onClose={() => setZoom(null)} />
      )}
    </div>
  );
}
