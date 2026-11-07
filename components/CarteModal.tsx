"use client";

import { useEffect, useRef, useState } from "react";
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
  /** Raretés possédées (de la plus haute à la plus basse) : permet de swiper vers les cartes inférieures */
  raretes?: Rarete[];
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

export default function CarteModal({ personne, rarete: rareteInitiale, raretes, gagnee = true, onClose }: Props) {
  const liste = raretes && raretes.length > 0 ? raretes : [rareteInitiale];
  const [index, setIndex] = useState(Math.max(0, liste.indexOf(rareteInitiale)));
  const rarete = liste[index] ?? rareteInitiale;
  const [ratio, setRatio] = useState(2 / 3);
  const [touchX, setTouchX] = useState<number | null>(null);
  // Glissement entre les couleurs : la carte sortante part d'un côté, la suivante arrive de l'autre
  const [dragX, setDragX] = useState(0);
  const [drag, setDrag] = useState(false);
  const [sortie, setSortie] = useState<{ rarete: Rarete; vers: "g" | "d"; dx: number; id: number } | null>(null);
  const [entree, setEntree] = useState<{ depuis: "g" | "d"; id: number } | null>(null);

  const aller = (i: number, dx = 0) => {
    if (i < 0 || i >= liste.length || i === index) return;
    const versSuivante = i > index; // carte inférieure : la carte actuelle part à gauche
    const id = Date.now();
    setSortie({ rarete, vers: versSuivante ? "g" : "d", dx, id });
    setEntree({ depuis: versSuivante ? "d" : "g", id });
    setIndex(i);
    setDragX(0);
  };

  const allerRef = useRef(aller);
  const indexRef = useRef(index);
  useEffect(() => {
    allerRef.current = aller;
    indexRef.current = index;
  });

  // Précharge toutes les couleurs pour que la carte suivante apparaisse sans délai
  useEffect(() => {
    liste.forEach((r) => {
      const img = new window.Image();
      img.src = getCarteUrl(personne, r);
    });
  }, [personne, liste.join(",")]);

  const [imageChargee, setImageChargee] = useState(false);
  const [delaiPasse, setDelaiPasse] = useState(!gagnee);
  const revele = imageChargee && delaiPasse;

  const color = RARETE_COLOR[rarete];
  const p = getPersonne(personne);
  const url = getCarteUrl(personne, rarete);

  useEffect(() => {
    const img = new window.Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight);
      setImageChargee(true);
    };
    img.onerror = () => setImageChargee(true); // on ne bloque jamais la modale
    img.src = url;
  }, [url]);

  useEffect(() => {
    if (!gagnee) return;
    const t = setTimeout(() => setDelaiPasse(true), 900);
    return () => clearTimeout(t);
  }, [gagnee]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") allerRef.current(indexRef.current + 1);
      if (e.key === "ArrowLeft") allerRef.current(indexRef.current - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const glowDe = (r: Rarete) =>
    r === "or"
      ? "0 0 60px 12px rgba(242,185,15,0.55), 0 0 120px 30px rgba(242,185,15,0.25)"
      : r === "argent"
      ? "0 0 40px 6px rgba(201,209,222,0.4)"
      : "0 0 40px 6px rgba(59,123,255,0.4)";

  /** Recto d'une carte (image, halo, reflet) */
  const recto = (r: Rarete, visible: boolean) => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backfaceVisibility: "hidden",
        borderRadius: 18,
        overflow: "hidden",
        boxShadow: visible ? glowDe(r) : "none",
        animation: visible && r !== "bleu" ? "vic-pulse 2.2s ease-in-out infinite" : undefined,
      }}
    >
      <img
        src={getCarteUrl(personne, r)}
        alt={`Carte ${p?.prenom ?? ""} ${p?.nom ?? ""}`}
        className="w-full h-full object-contain"
        draggable={false}
      />
      {r !== "bleu" && visible && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              width: "40%",
              background: `linear-gradient(90deg, transparent, ${
                r === "or" ? "rgba(255,240,170,0.55)" : "rgba(255,255,255,0.4)"
              }, transparent)`,
              animation: "vic-shine 2.8s ease-in-out infinite",
            }}
          />
        </div>
      )}
    </div>
  );


  const titre = gagnee
    ? "Tu viens de gagner une carte"
    : `${p?.prenom ?? ""} ${p?.nom ?? ""}`.trim();

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center px-4 overflow-hidden"
      style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <style>{`
        @keyframes vic-fadein { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes vic-pulse { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.12); } }
        @keyframes vic-shine { 0% { transform: translateX(-130%) skewX(-20deg); } 55%,100% { transform: translateX(230%) skewX(-20deg); } }
        @keyframes vic-out-g { from { transform: translateX(var(--dx)) rotate(var(--rot)); opacity: 1; } to { transform: translateX(-140%) rotate(-14deg); opacity: 0; } }
        @keyframes vic-out-d { from { transform: translateX(var(--dx)) rotate(var(--rot)); opacity: 1; } to { transform: translateX(140%) rotate(14deg); opacity: 0; } }
        @keyframes vic-in-d { from { transform: translateX(140%) rotate(14deg); opacity: 0; } to { transform: none; opacity: 1; } }
        @keyframes vic-in-g { from { transform: translateX(-140%) rotate(-14deg); opacity: 0; } to { transform: none; opacity: 1; } }
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

      {/* Navigation entre les raretés possédées */}
      {liste.length > 1 && (
        <>
          {index > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); aller(index - 1); }}
              aria-label="Carte supérieure"
              className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full text-xl z-10"
              style={{ background: "rgba(255,255,255,0.12)", color: "white" }}
            >‹</button>
          )}
          {index < liste.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); aller(index + 1); }}
              aria-label="Carte inférieure"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full text-xl z-10"
              style={{ background: "rgba(255,255,255,0.12)", color: "white" }}
            >›</button>
          )}
          <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-2" onClick={(e) => e.stopPropagation()}>
            {liste.map((r, i) => (
              <button
                key={r}
                onClick={() => aller(i)}
                aria-label={`Carte ${RARETE_LABEL[r]}`}
                style={{
                  width: i === index ? 22 : 8,
                  height: 8,
                  borderRadius: 4,
                  background: RARETE_COLOR[r],
                  opacity: i === index ? 1 : 0.4,
                  transition: "all .2s",
                }}
              />
            ))}
          </div>
        </>
      )}

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
          <p
            key={rarete}
            className="text-xs uppercase tracking-widest mt-1"
            style={{ color, animation: "vic-fadein 0.35s ease both" }}
          >
            Carte {RARETE_LABEL[rarete]}
          </p>
        )}
      </div>

      {/* Carte qui se retourne */}
      <div
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          if (liste.length < 2) return;
          setTouchX(e.touches[0].clientX);
          setDrag(true);
        }}
        onTouchMove={(e) => {
          if (touchX === null) return;
          const dx = e.touches[0].clientX - touchX;
          // Au bord (pas de carte de ce côté), la carte résiste
          const bord = (dx > 0 && index === 0) || (dx < 0 && index === liste.length - 1);
          setDragX(bord ? dx / 4 : dx);
        }}
        onTouchEnd={() => {
          if (touchX === null) return;
          setTouchX(null);
          setDrag(false);
          if (Math.abs(dragX) < 60) {
            setDragX(0); // revient au centre
            return;
          }
          // glisser vers la gauche → carte inférieure
          const cible = dragX < 0 ? index + 1 : index - 1;
          if (cible < 0 || cible >= liste.length) {
            setDragX(0);
            return;
          }
          aller(cible, dragX);
        }}
        style={{
          perspective: 1200,
          position: "relative",
          width: `min(80vw, 340px, calc(62dvh * ${ratio}))`,
          aspectRatio: `${ratio}`,
          touchAction: "pan-y",
        }}
      >
        {sortie && (
          <div
            key={sortie.id}
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget) setSortie(null);
            }}
            style={
              {
                position: "absolute",
                inset: 0,
                zIndex: 0,
                pointerEvents: "none",
                "--dx": `${sortie.dx}px`,
                "--rot": `${sortie.dx / 25}deg`,
                animation: `vic-out-${sortie.vers} 0.4s cubic-bezier(.4,0,.6,1) both`,
              } as React.CSSProperties
            }
          >
            {recto(sortie.rarete, true)}
          </div>
        )}

        <div
          style={{
            position: "relative",
            zIndex: 1,
            width: "100%",
            height: "100%",
            transformStyle: "preserve-3d",
            transition: gagnee ? "transform 0.9s cubic-bezier(.2,.8,.2,1)" : "none",
            transform: revele ? "rotateY(0deg)" : "rotateY(180deg)",
          }}
        >
          {/* Face avant : suit le doigt, puis arrive en glissant quand on change de couleur */}
          <div
            key={entree?.id ?? 0}
            style={{
              position: "absolute",
              inset: 0,
              transformStyle: "preserve-3d",
              transform: dragX ? `translateX(${dragX}px) rotate(${dragX / 25}deg)` : undefined,
              transition: drag ? "none" : "transform 0.25s ease",
              animation: entree ? `vic-in-${entree.depuis} 0.4s cubic-bezier(.2,.8,.2,1) both` : undefined,
            }}
          >
            {recto(rarete, revele)}
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
