"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RoomConnect, { RoomContext } from "./RoomConnect";
import type { NetMessage } from "@/lib/p2pRoom";

/* ════════════════════════════════════════════════════════════════════════════
   1. TERRAIN & PHYSIQUE (unités réelles, mètres / secondes)
   Tout est en cotes FIBA/NBA : c'est la simulation qui décide si ça rentre,
   plus aucun tirage au sort sur le résultat.
   ═══════════════════════════════════════════════════════════════════════════ */

const G = 9.81;
const BALL_R = 0.1197; // rayon ballon taille 7
const RIM_R = 0.2286; // rayon arceau (45,7 cm de diamètre)
const RIM_TUBE = 0.009; // épaisseur du tube de l'arceau
const RIM_Y = 3.048; // hauteur de l'arceau
const RIM_Z = 4.2; // distance arceau ↔ ligne de lancer franc
const BOARD_Z = RIM_Z + 0.375; // face avant de la planche
const BOARD_Y0 = 2.9;
const BOARD_Y1 = 3.95;
const BOARD_HW = 0.9; // demi-largeur planche (1,80 m)
const BASE_Z = 5.3; // ligne de fond

const RELEASE = { x: 0, y: 2.25, z: 0.3 }; // point de relâche, bras tendu
const SHOT_D = RIM_Z - RELEASE.z;
const DROP = RIM_Y - RELEASE.y;
const BASE_ANGLE = 55; // relâche idéale → ~45° d'angle d'entrée dans l'arceau
const ANGLE_COMP = 0.55; // le tireur compense spontanément une partie de son erreur d'angle

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Vitesse de relâche qui fait rentrer le ballon pile au centre, pour un angle donné. */
function idealSpeed(deg: number): number {
  const th = (deg * Math.PI) / 180;
  const c = Math.cos(th);
  const denom = 2 * c * c * (SHOT_D * Math.tan(th) - DROP);
  if (denom <= 0.01) return 14;
  return Math.sqrt((G * SHOT_D * SHOT_D) / denom);
}

type Outcome = "swish" | "made" | "rimout" | "miss";
interface Pt {
  x: number;
  y: number;
  z: number;
}
interface ShotParams {
  speed: number;
  angleDeg: number;
  lateralDeg: number;
  spin: number; // tours/s de rétro
}
interface SimResult {
  id: number;
  path: Pt[];
  frameDt: number;
  outcome: Outcome;
  detail: string;
  scored: boolean;
  touchedRim: boolean;
  touchedBoard: boolean;
  scoreFrame: number;
  entryDeg: number;
  spin: number;
  grade: Grade;
}
interface Grade {
  push: number;
  snap: number;
  axis: number;
}

function simulate(p: ShotParams): Omit<SimResult, "id" | "grade"> {
  const th = (p.angleDeg * Math.PI) / 180;
  const lat = (p.lateralDeg * Math.PI) / 180;
  const horiz = p.speed * Math.cos(th);
  const pos: Pt = { ...RELEASE };
  const vel = {
    x: horiz * Math.sin(lat),
    y: p.speed * Math.sin(th),
    z: horiz * Math.cos(lat),
  };

  const dt = 1 / 480;
  const path: Pt[] = [{ ...pos }];
  let scored = false;
  let touchedRim = false;
  let touchedBoard = false;
  let scoreT = -1;
  let floorHits = 0;
  let rimHits = 0;
  let measured = false;
  let depthErr = 0;
  let lateralErr = 0;
  let entryDeg = 0;
  let t = 0;

  const grip = clamp(p.spin / 9); // la rétro « mord » l'arceau et fait tomber la balle

  for (let i = 0; i < 480 * 4; i++) {
    const py = pos.y;
    const px = pos.x;
    const pz = pos.z;

    vel.y -= G * dt;
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;
    t += dt;

    // Planche
    if (
      pos.z + BALL_R > BOARD_Z &&
      pz + BALL_R <= BOARD_Z &&
      pos.y > BOARD_Y0 &&
      pos.y < BOARD_Y1 &&
      Math.abs(pos.x) < BOARD_HW
    ) {
      pos.z = BOARD_Z - BALL_R;
      vel.z = -vel.z * 0.56;
      vel.x *= 0.88;
      vel.y *= 0.92;
      touchedBoard = true;
    }

    // Arceau (collision ballon / anneau)
    const hx = pos.x;
    const hz = pos.z - RIM_Z;
    const hr = Math.hypot(hx, hz);
    if (hr > 1e-4 && rimHits < 6) {
      const nx = (hx / hr) * RIM_R;
      const nz = (hz / hr) * RIM_R;
      const dx = pos.x - nx;
      const dy = pos.y - RIM_Y;
      const dz = pos.z - (RIM_Z + nz);
      const d = Math.hypot(dx, dy, dz);
      const minD = BALL_R + RIM_TUBE;
      if (d < minD && d > 1e-5) {
        const ux = dx / d;
        const uy = dy / d;
        const uz = dz / d;
        pos.x = nx + ux * minD;
        pos.y = RIM_Y + uy * minD;
        pos.z = RIM_Z + nz + uz * minD;
        const vn = vel.x * ux + vel.y * uy + vel.z * uz;
        const rest = 0.42;
        vel.x -= (1 + rest) * vn * ux;
        vel.y -= (1 + rest) * vn * uy;
        vel.z -= (1 + rest) * vn * uz;
        vel.z *= 1 - 0.3 * grip; // la rétro tue la vitesse d'avancée
        vel.x *= 1 - 0.15 * grip;
        touchedRim = true;
        rimHits++;
      }
    }

    // Diagnostic : on extrapole la descente depuis 35 cm au-dessus de l'arceau,
    // donc avant tout contact — sinon on mesurerait l'angle d'un rebond.
    if (!measured && py > RIM_Y + 0.35 && pos.y <= RIM_Y + 0.35 && vel.y < 0) {
      const vy = -vel.y;
      const tf = (-vy + Math.sqrt(vy * vy + 2 * G * 0.35)) / G;
      measured = true;
      depthErr = pos.z + vel.z * tf - RIM_Z;
      lateralErr = pos.x + vel.x * tf;
      entryDeg = (Math.atan2(vy + G * tf, Math.hypot(vel.x, vel.z)) * 180) / Math.PI;
    }

    // Passage réel du plan de l'arceau, vers le bas
    if (py > RIM_Y && pos.y <= RIM_Y && vel.y < 0 && !scored) {
      const f = (py - RIM_Y) / (py - pos.y || 1);
      const cx = lerp(px, pos.x, f);
      const cz = lerp(pz, pos.z, f);
      if (Math.hypot(cx, cz - RIM_Z) < RIM_R - 0.004) {
        scored = true;
        scoreT = t;
      }
    }

    // Sol
    if (pos.y - BALL_R <= 0 && vel.y < 0) {
      pos.y = BALL_R;
      vel.y = -vel.y * 0.62;
      vel.x *= 0.82;
      vel.z *= 0.82;
      floorHits++;
    }

    if (i % 4 === 0) path.push({ ...pos });
    if (scored && t > scoreT + 0.5) break;
    if (floorHits >= 2) break;
    if (t > 3) break;
  }

  let outcome: Outcome;
  let detail: string;
  if (scored && !touchedRim && !touchedBoard) {
    outcome = "swish";
    detail = "Ficelle. Rien que le filet.";
  } else if (scored) {
    outcome = "made";
    detail = touchedBoard
      ? "Planche, et dedans."
      : touchedRim
      ? "Ça tourne… et ça tombe."
      : "Dedans.";
  } else {
    outcome = touchedRim || touchedBoard ? "rimout" : "miss";
    if (!measured) {
      detail = "Air ball : bien trop court.";
    } else if (Math.abs(lateralErr) > 0.16 && Math.abs(lateralErr) > Math.abs(depthErr)) {
      detail = lateralErr > 0 ? "Parti à droite. Garde l'axe." : "Parti à gauche. Garde l'axe.";
    } else if (entryDeg < 34) {
      detail = "Trajectoire trop tendue : casse davantage le poignet.";
    } else if (entryDeg > 56 && depthErr < 0) {
      detail = "Cloche trop haute, et donc trop courte. Casse moins.";
    } else if (depthErr < -0.06) {
      detail = "Trop court. Pousse un peu plus.";
    } else if (depthErr > 0.06) {
      detail = "Trop long. Tu as forcé la montée.";
    } else {
      detail = "Sur l'arceau, à un souffle près.";
    }
  }

  return {
    path,
    frameDt: dt * 4,
    outcome,
    detail,
    scored,
    touchedRim,
    touchedBoard,
    scoreFrame: scoreT >= 0 ? Math.floor(scoreT / (dt * 4)) : -1,
    entryDeg,
    spin: p.spin,
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   2. GESTE → TIR
   Le geste produit trois erreurs signées normalisées (-1 … 1). Une zone morte
   rend les bons gestes parfaits, pour que la réussite dépende du joueur et pas
   du bruit des capteurs.
   ═══════════════════════════════════════════════════════════════════════════ */

interface GestureMetrics {
  push: number; // -1 trop mou … +1 trop fort
  snap: number; // -1 pas de cassé … +1 poignet cassé à l'excès
  lateral: number; // -1 gauche … +1 droite
  axis: number; // 0…1 : maintien de l'axe pendant tout le geste
  timing: number; // 0…1 : synchro montée → cassé
  source: "motion" | "pointer";
}

interface Difficulty {
  key: "arcade" | "pro";
  label: string;
  dead: number;
  power: number;
  lateral: number;
  angle: number;
}

const DIFFICULTIES: Difficulty[] = [
  { key: "arcade", label: "Souple", dead: 0.42, power: 0.028, lateral: 4.6, angle: 12 },
  { key: "pro", label: "Réaliste", dead: 0.17, power: 0.035, lateral: 5.7, angle: 15 },
];

/** Bruit gaussien : deux tirs identiques ne donnent jamais exactement le même
 *  résultat, comme au vrai lancer franc. */
function gauss(sigma: number) {
  const u = Math.max(1e-6, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()) * sigma;
}

function soften(e: number, dead: number) {
  const a = Math.abs(e);
  if (a <= dead) return 0;
  return Math.sign(e) * ((a - dead) / (1 - dead));
}

function buildShot(m: GestureMetrics, d: Difficulty): { params: ShotParams; grade: Grade } {
  const pushE = soften(m.push, d.dead);
  const snapE = soften(m.snap, d.dead);
  const latE = soften(m.lateral, d.dead * 0.85);

  // Le poignet donne l'angle, la montée donne la vitesse. Le tireur compense
  // spontanément une partie de son erreur d'angle : au-delà, la balle est
  // trop courte (tir trop tendu) ou trop longue (cloche démesurée).
  const angleDeg = BASE_ANGLE + snapE * d.angle + gauss(0.5);
  // Trop long pardonne naturellement plus que trop court (planche, cercle
  // arrière) : on rééquilibre pour que les deux fautes se valent.
  const powerScale = d.power * (pushE > 0 ? 1.3 : 1);
  let speed = idealSpeed(BASE_ANGLE + ANGLE_COMP * (angleDeg - BASE_ANGLE)) * (1 + pushE * powerScale);
  speed *= 1 - 0.006 * (1 - m.timing); // désynchro montée / poignet
  speed *= 1 + gauss(0.0035); // main humaine

  const lateralDeg = latE * d.lateral + gauss(0.25 + (1 - m.axis) * 0.9);

  const spin = 1.5 + 8 * clamp(1 - Math.abs(m.snap)) * clamp(0.45 + 0.55 * m.timing);

  return {
    params: { speed, angleDeg, lateralDeg, spin },
    grade: {
      push: clamp(1 - Math.abs(m.push)),
      snap: clamp(1 - Math.abs(m.snap)),
      axis: clamp(m.axis * (1 - Math.abs(m.lateral) * 0.55)),
    },
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   3. CAMÉRA & RENDU
   Vue perspective légèrement en surplomb derrière le tireur : on lit à la fois
   la cloche du tir (haut/bas) et la déviation gauche/droite.
   ═══════════════════════════════════════════════════════════════════════════ */

interface Cam {
  px: number;
  py: number;
  pz: number;
  sp: number;
  cp: number;
  f: number;
  yc: number;
  xc: number;
}

function makeCam(W: number, H: number): Cam {
  const px = 0;
  const py = 4.9; // compromis : cercle lisible comme cible, cloche du tir lisible aussi
  const pz = -2.6;
  const pitch = Math.atan2(py - 2.95, 2.3 - pz);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const ratio = (y: number, z: number) => {
    const dy = y - py;
    const dz = z - pz;
    return (dy * cp + dz * sp) / (-dy * sp + dz * cp);
  };
  const rRel = ratio(RELEASE.y, RELEASE.z);
  const rRim = ratio(RIM_Y, RIM_Z);
  // Cadrage : le ballon part à 89 % de la hauteur, l'arceau se pose à 31 %,
  // ce qui laisse de la marge au-dessus pour les cloches les plus hautes.
  const f = (0.89 * H - 0.31 * H) / (rRim - rRel);
  const yc = 0.31 * H + f * rRim;
  return { px, py, pz, sp, cp, f, yc, xc: W / 2 };
}

interface P2 {
  x: number;
  y: number;
  s: number;
  cz: number;
}
function project(c: Cam, x: number, y: number, z: number): P2 | null {
  const dx = x - c.px;
  const dy = y - c.py;
  const dz = z - c.pz;
  const cz = -dy * c.sp + dz * c.cp;
  if (cz < 0.2) return null;
  const cy = dy * c.cp + dz * c.sp;
  const s = c.f / cz;
  return { x: c.xc + dx * s, y: c.yc - cy * s, s, cz };
}

function seg(
  g: CanvasRenderingContext2D,
  c: Cam,
  a: [number, number, number],
  b: [number, number, number]
) {
  const p = project(c, a[0], a[1], a[2]);
  const q = project(c, b[0], b[1], b[2]);
  if (!p || !q) return;
  g.beginPath();
  g.moveTo(p.x, p.y);
  g.lineTo(q.x, q.y);
  g.stroke();
}

interface SceneOpts {
  ball: Pt;
  spinRad: number;
  trail: Pt[];
  netKick: number;
  accent: string;
  glow: number;
}

function drawScene(g: CanvasRenderingContext2D, c: Cam, W: number, H: number, o: SceneOpts) {
  // ── Fond : salle sombre, halo au-dessus du panier
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#070B15");
  bg.addColorStop(0.55, "#0C1322");
  bg.addColorStop(1, "#060910");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  const rim = project(c, 0, RIM_Y, RIM_Z);
  if (rim) {
    const halo = g.createRadialGradient(rim.x, rim.y - 20, 4, rim.x, rim.y - 20, W * 0.55);
    halo.addColorStop(0, `rgba(255,255,255,${0.1 + o.glow * 0.25})`);
    halo.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = halo;
    g.fillRect(0, 0, W, H);
  }

  // ── Mur du fond
  const wall: Array<[number, number, number]> = [
    [-9, 0, BASE_Z + 0.9],
    [9, 0, BASE_Z + 0.9],
    [9, 9, BASE_Z + 0.9],
    [-9, 9, BASE_Z + 0.9],
  ];
  const wp = wall.map((q) => project(c, q[0], q[1], q[2]));
  if (wp.every(Boolean)) {
    const w = wp as P2[];
    const wg = g.createLinearGradient(0, w[2].y, 0, w[0].y);
    wg.addColorStop(0, "#080C17");
    wg.addColorStop(1, "#141D31");
    g.beginPath();
    g.moveTo(w[0].x, w[0].y);
    w.slice(1).forEach((q) => g.lineTo(q.x, q.y));
    g.closePath();
    g.fillStyle = wg;
    g.fill();
  }

  // ── Parquet
  const corners: Array<[number, number, number]> = [
    [-6, 0, 0.9],
    [6, 0, 0.9],
    [6, 0, BASE_Z + 0.9],
    [-6, 0, BASE_Z + 0.9],
  ];
  const proj = corners.map((p) => project(c, p[0], p[1], p[2]));
  if (proj.every(Boolean)) {
    const pts = proj as P2[];
    const floor = g.createLinearGradient(0, pts[2].y, 0, pts[0].y);
    floor.addColorStop(0, "#2A1B10");
    floor.addColorStop(0.45, "#6B4526");
    floor.addColorStop(1, "#8A5A31");
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach((p) => g.lineTo(p.x, p.y));
    g.closePath();
    g.fillStyle = floor;
    g.fill();

    // lattes
    g.strokeStyle = "rgba(0,0,0,0.12)";
    g.lineWidth = 1;
    for (let x = -6; x <= 6; x += 0.6) seg(g, c, [x, 0, 0.9], [x, 0, BASE_Z + 0.9]);
  }

  // ── Marquage de la raquette
  g.strokeStyle = "rgba(240,244,255,0.5)";
  g.lineWidth = 2;
  seg(g, c, [-2.45, 0.01, 0], [2.45, 0.01, 0]); // ligne de lancer franc
  seg(g, c, [-2.45, 0.01, 0], [-2.45, 0.01, BASE_Z]);
  seg(g, c, [2.45, 0.01, 0], [2.45, 0.01, BASE_Z]);
  seg(g, c, [-3, 0.01, BASE_Z], [3, 0.01, BASE_Z]);
  g.strokeStyle = "rgba(240,244,255,0.28)";
  g.beginPath();
  let started = false;
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 24) {
    const p = project(c, Math.sin(a) * 1.8, 0.01, Math.cos(a) * 1.8);
    if (!p) {
      started = false;
      continue;
    }
    if (!started) {
      g.moveTo(p.x, p.y);
      started = true;
    } else g.lineTo(p.x, p.y);
  }
  g.stroke();

  // ── Poteau
  g.strokeStyle = "#1B2438";
  g.lineWidth = 10;
  seg(g, c, [0, 0, BASE_Z + 0.55], [0, 3.6, BASE_Z + 0.55]);
  g.lineWidth = 7;
  seg(g, c, [0, 3.5, BASE_Z + 0.55], [0, 3.5, BOARD_Z + 0.05]);

  // ── Planche
  const b0 = project(c, -BOARD_HW, BOARD_Y1, BOARD_Z);
  const b1 = project(c, BOARD_HW, BOARD_Y1, BOARD_Z);
  const b2 = project(c, BOARD_HW, BOARD_Y0, BOARD_Z);
  const b3 = project(c, -BOARD_HW, BOARD_Y0, BOARD_Z);
  if (b0 && b1 && b2 && b3) {
    g.beginPath();
    g.moveTo(b0.x, b0.y);
    g.lineTo(b1.x, b1.y);
    g.lineTo(b2.x, b2.y);
    g.lineTo(b3.x, b3.y);
    g.closePath();
    g.fillStyle = "rgba(226,238,255,0.09)";
    g.fill();
    g.strokeStyle = "rgba(226,238,255,0.75)";
    g.lineWidth = 3;
    g.stroke();
  }
  g.strokeStyle = "rgba(226,238,255,0.85)";
  g.lineWidth = 2.5;
  seg(g, c, [-0.295, 3.048, BOARD_Z], [0.295, 3.048, BOARD_Z]);
  seg(g, c, [-0.295, 3.503, BOARD_Z], [0.295, 3.503, BOARD_Z]);
  seg(g, c, [-0.295, 3.048, BOARD_Z], [-0.295, 3.503, BOARD_Z]);
  seg(g, c, [0.295, 3.048, BOARD_Z], [0.295, 3.503, BOARD_Z]);

  // ── Filet (brins arrière puis avant, pour encadrer le ballon)
  const strands = 12;
  const kick = o.netKick;
  const netPt = (a: number, depth: number) => {
    const rr = lerp(RIM_R, RIM_R * 0.42, depth);
    const sag = 0.42 * depth * (1 + kick * 0.5);
    return {
      x: Math.sin(a) * rr + kick * (o.ball.x - 0) * 0.25,
      y: RIM_Y - sag,
      z: RIM_Z + Math.cos(a) * rr + kick * (o.ball.z - RIM_Z) * 0.25,
    };
  };
  const drawStrands = (far: boolean) => {
    g.strokeStyle = "rgba(255,255,255,0.5)";
    g.lineWidth = 1.4;
    for (let i = 0; i < strands; i++) {
      const a = (i / strands) * Math.PI * 2;
      const isFar = Math.cos(a) > 0;
      if (isFar !== far) continue;
      g.beginPath();
      let first = true;
      for (let d = 0; d <= 1.001; d += 0.25) {
        const q = netPt(a, d);
        const p = project(c, q.x, q.y, q.z);
        if (!p) continue;
        if (first) {
          g.moveTo(p.x, p.y);
          first = false;
        } else g.lineTo(p.x, p.y);
      }
      g.stroke();
    }
    g.strokeStyle = "rgba(255,255,255,0.28)";
    for (const d of [0.4, 0.75]) {
      g.beginPath();
      let first = true;
      for (let i = 0; i <= strands; i++) {
        const a = (i / strands) * Math.PI * 2;
        if (Math.cos(a) > 0 !== far) {
          first = true;
          continue;
        }
        const q = netPt(a, d);
        const p = project(c, q.x, q.y, q.z);
        if (!p) continue;
        if (first) {
          g.moveTo(p.x, p.y);
          first = false;
        } else g.lineTo(p.x, p.y);
      }
      g.stroke();
    }
  };

  const rimArc = (far: boolean) => {
    g.strokeStyle = o.accent;
    g.lineWidth = 4;
    g.lineCap = "round";
    g.beginPath();
    let first = true;
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      if (Math.cos(a) > 0 !== far) {
        first = true;
        continue;
      }
      const p = project(c, Math.sin(a) * RIM_R, RIM_Y, RIM_Z + Math.cos(a) * RIM_R);
      if (!p) continue;
      if (first) {
        g.moveTo(p.x, p.y);
        first = false;
      } else g.lineTo(p.x, p.y);
    }
    g.stroke();
  };

  // disque sombre dans l'ouverture : c'est lui qui fait lire le cercle comme une cible
  g.save();
  g.beginPath();
  let ringStarted = false;
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const q = project(c, Math.sin(a) * RIM_R, RIM_Y, RIM_Z + Math.cos(a) * RIM_R);
    if (!q) continue;
    if (!ringStarted) {
      g.moveTo(q.x, q.y);
      ringStarted = true;
    } else g.lineTo(q.x, q.y);
  }
  g.closePath();
  g.fillStyle = "rgba(4,7,14,0.72)";
  g.fill();
  g.restore();

  rimArc(true);
  drawStrands(true);

  // ── Ombre portée
  const sh = project(c, o.ball.x, 0.015, o.ball.z);
  if (sh) {
    const k = clamp(1 - (o.ball.y - BALL_R) / 4);
    g.save();
    g.globalAlpha = 0.28 * k;
    g.fillStyle = "#000";
    g.beginPath();
    g.ellipse(sh.x, sh.y, BALL_R * sh.s * (1.6 - k * 0.5), BALL_R * sh.s * 0.45, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // ── Traînée
  for (let i = 0; i < o.trail.length; i++) {
    const q = o.trail[i];
    const p = project(c, q.x, q.y, q.z);
    if (!p) continue;
    const k = (i + 1) / o.trail.length;
    g.globalAlpha = 0.22 * k;
    g.fillStyle = o.accent;
    g.beginPath();
    g.arc(p.x, p.y, BALL_R * p.s * 0.45 * k, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // ── Ballon
  const bp = project(c, o.ball.x, o.ball.y, o.ball.z);
  if (bp) {
    const r = Math.max(3, BALL_R * bp.s);
    const grad = g.createRadialGradient(bp.x - r * 0.35, bp.y - r * 0.4, r * 0.1, bp.x, bp.y, r);
    grad.addColorStop(0, "#FBA55C");
    grad.addColorStop(0.55, "#E8641C");
    grad.addColorStop(1, "#A83C08");
    g.save();
    g.translate(bp.x, bp.y);
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fillStyle = grad;
    g.fill();
    g.clip();
    g.rotate(o.spinRad);
    g.strokeStyle = "rgba(40,16,4,0.75)";
    g.lineWidth = Math.max(1, r * 0.09);
    g.beginPath();
    g.moveTo(-r, 0);
    g.lineTo(r, 0);
    g.stroke();
    for (const k of [-0.55, 0.55]) {
      g.beginPath();
      g.ellipse(k * r * 1.25, 0, r * 0.95, r, 0, -Math.PI / 2, Math.PI / 2, k < 0);
      g.stroke();
    }
    g.beginPath();
    g.ellipse(0, 0, r * 0.32, r, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    g.beginPath();
    g.arc(bp.x, bp.y, r, 0, Math.PI * 2);
    g.strokeStyle = "rgba(0,0,0,0.35)";
    g.lineWidth = 1.2;
    g.stroke();
  }

  drawStrands(false);
  rimArc(false);
}

/* ─── Canvas du terrain ─────────────────────────────────────────────────────── */

function CourtCanvas({
  shot,
  onDone,
  aimHint,
}: {
  shot: SimResult | null;
  onDone: (s: SimResult) => void;
  aimHint: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shotRef = useRef<SimResult | null>(null);
  const startRef = useRef(0);
  const firedRef = useRef(true);
  const doneRef = useRef(onDone);
  const aimRef = useRef(aimHint);
  doneRef.current = onDone;
  aimRef.current = aimHint;

  useEffect(() => {
    if (!shot) return;
    shotRef.current = shot;
    startRef.current = performance.now();
    firedRef.current = false;
  }, [shot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let W = 0;
    let H = 0;
    let cam = makeCam(1, 1);
    const accent =
      getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#E8641C";

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.clientWidth;
      H = Math.round(W * 1.2);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.height = `${H}px`;
      const g = canvas.getContext("2d");
      if (g) g.setTransform(dpr, 0, 0, dpr, 0, 0);
      cam = makeCam(W, H);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const g = canvas.getContext("2d");
      if (!g || W === 0) return;
      const s = shotRef.current;

      let ball: Pt = { ...RELEASE };
      let spinRad = 0;
      let trail: Pt[] = [];
      let netKick = 0;
      let glow = 0;

      if (s) {
        const t = (now - startRef.current) / 1000;
        const maxT = (s.path.length - 1) * s.frameDt;
        const tt = Math.min(t, maxT);
        const fi = tt / s.frameDt;
        const i0 = Math.min(s.path.length - 1, Math.floor(fi));
        const i1 = Math.min(s.path.length - 1, i0 + 1);
        const f = fi - i0;
        const a = s.path[i0];
        const b = s.path[i1];
        ball = { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f) };
        spinRad = -tt * s.spin * Math.PI * 2;
        trail = s.path.slice(Math.max(0, i0 - 14), i0 + 1);
        if (s.scoreFrame >= 0 && i0 >= s.scoreFrame) {
          const k = (i0 - s.scoreFrame) * s.frameDt;
          netKick = Math.max(0, Math.exp(-k * 4) * Math.cos(k * 26)) ;
          glow = Math.max(0, 1 - k * 1.6);
        }
        if (!firedRef.current && t >= maxT + 0.25) {
          firedRef.current = true;
          doneRef.current(s);
        }
      } else {
        const bob = Math.sin(now / 620) * 0.035;
        ball = { x: RELEASE.x, y: RELEASE.y + bob, z: RELEASE.z };
        spinRad = now / 2400;
      }

      drawScene(g, cam, W, H, { ball, spinRad, trail, netKick, accent, glow });

      // repère d'axe pendant la visée
      if (!s || firedRef.current) {
        const a = project(cam, 0, RIM_Y - 0.02, RIM_Z);
        const b = project(cam, aimRef.current * 0.01, RELEASE.y + 0.25, RELEASE.z + 0.5);
        if (a && b) {
          g.save();
          g.setLineDash([4, 8]);
          g.strokeStyle = "rgba(255,255,255,0.14)";
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(b.x, b.y);
          g.lineTo(a.x, a.y);
          g.stroke();
          g.restore();
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="w-full block rounded-2xl" style={{ border: "1px solid var(--border-card)" }} />;
}

/* ════════════════════════════════════════════════════════════════════════════
   4. CAPTEURS — contrôleur mobile
   Montée (accélération sur l'axe Y du téléphone, intégrée en vitesse)
   puis cassé de poignet (pic de rotationRate.beta) dans la foulée.
   L'orientation doit rester dans l'axe pendant tout le geste.
   ═══════════════════════════════════════════════════════════════════════════ */

const IDEAL_PUSH_V = 2.0; // m/s au sommet de la montée
const PUSH_TOL = 1.1;
const IDEAL_SNAP = 430; // °/s au pic de rotation
const SNAP_TOL = 320;
const IDEAL_DELAY = 0.11; // s entre fin de montée et cassé
const DELAY_TOL = 0.22;
const TARGET_BETA = 74; // téléphone tenu quasi vertical, écran vers soi
const BETA_TOL = 26;
const GAMMA_TOL = 14;

type Perm = "unknown" | "unsupported" | "granted" | "denied";

async function askSensors(): Promise<boolean> {
  try {
    const DM = window.DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<PermissionState | "granted" | "denied">;
    };
    const DO = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<PermissionState | "granted" | "denied">;
    };
    let ok = typeof window.DeviceMotionEvent !== "undefined";
    if (typeof DM?.requestPermission === "function") ok = (await DM.requestPermission()) === "granted";
    if (typeof DO?.requestPermission === "function") await DO.requestPermission();
    return ok;
  } catch {
    return false;
  }
}

const buzz = (ms: number | number[]) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignoré */
  }
};

function MotionController({
  disabled,
  onShot,
  onFallback,
}: {
  disabled: boolean;
  onShot: (m: GestureMetrics) => void;
  onFallback: () => void;
}) {
  const [perm, setPerm] = useState<Perm>("unknown");
  const [armed, setArmed] = useState(false);
  const [stage, setStage] = useState<"wait" | "rise" | "snap">("wait");
  const [aligned, setAligned] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const bubbleRef = useRef<HTMLDivElement>(null);
  const gaugeRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef({ beta: TARGET_BETA, gamma: 0, ok: false });
  const armedRef = useRef(false);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const gRef = useRef({ x: 0, y: 0, z: 0, init: false });
  const stRef = useRef({
    state: "idle" as "idle" | "rise" | "await",
    vx: 0,
    vy: 0,
    vz: 0,
    peakV: 0,
    t0: 0,
    tPeak: 0,
    snapPeak: 0,
    snapT: 0,
    cross: 0,
    beta: 0,
    rollSum: 0,
    yawDrift: 0,
    n: 0,
    last: 0,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof window.DeviceMotionEvent === "undefined") setPerm("unsupported");
  }, []);

  const reset = useCallback(() => {
    const s = stRef.current;
    s.state = "idle";
    s.vx = s.vy = s.vz = 0;
    s.peakV = 0;
    s.snapPeak = 0;
    s.snapT = 0;
    s.cross = 0;
    s.rollSum = 0;
    s.yawDrift = 0;
    s.n = 0;
    setStage("wait");
    if (gaugeRef.current) gaugeRef.current.style.transform = "scaleX(0)";
  }, []);

  const fire = useCallback(() => {
    const s = stRef.current;
    const push = clamp((s.peakV - IDEAL_PUSH_V) / PUSH_TOL, -1, 1);
    const snap = clamp((s.snapPeak - IDEAL_SNAP) / SNAP_TOL, -1, 1);
    const delay = s.snapT > 0 ? s.snapT - s.tPeak : 0.6;
    const timing = clamp(1 - Math.abs(delay - IDEAL_DELAY) / DELAY_TOL);
    const meanRoll = s.n > 0 ? s.rollSum / s.n : 0;
    const crossRatio = s.snapPeak > 40 ? clamp(s.cross / s.snapPeak) : 0.5;
    const axis = clamp(1 - meanRoll / 20 - crossRatio * 0.45);
    const lateralRad = Math.atan2(s.vx, Math.max(0.35, s.vy));
    const lateral = clamp(
      ((lateralRad * 180) / Math.PI) / 5.5 + s.yawDrift / 10,
      -1,
      1
    );

    armedRef.current = false;
    setArmed(false);
    reset();
    buzz(s.snapPeak > 200 ? [12, 40, 22] : 18);
    onShot({ push, snap, lateral, axis, timing, source: "motion" });
  }, [onShot, reset]);

  // orientation
  useEffect(() => {
    if (perm !== "granted") return;
    const h = (e: DeviceOrientationEvent) => {
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;
      const ok = Math.abs(beta - TARGET_BETA) < BETA_TOL && Math.abs(gamma) < GAMMA_TOL;
      tiltRef.current = { beta, gamma, ok };
      if (bubbleRef.current) {
        const dx = clamp(gamma / 30, -1, 1) * 42;
        const dy = clamp((beta - TARGET_BETA) / 40, -1, 1) * -42;
        bubbleRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
        bubbleRef.current.style.background = ok ? "#4ade80" : "var(--accent)";
      }
      setAligned((prev) => (prev === ok ? prev : ok));
    };
    window.addEventListener("deviceorientation", h);
    return () => window.removeEventListener("deviceorientation", h);
  }, [perm]);

  // mouvement
  useEffect(() => {
    if (perm !== "granted") return;
    const h = (e: DeviceMotionEvent) => {
      const s = stRef.current;
      const now = performance.now() / 1000;
      const dt = clamp(e.interval ? e.interval / 1000 : now - s.last, 0.004, 0.05);
      s.last = now;

      let a = e.acceleration;
      if (!a || (a.x === null && a.y === null && a.z === null)) {
        const raw = e.accelerationIncludingGravity;
        if (!raw) return;
        const gv = gRef.current;
        const rx = raw.x ?? 0;
        const ry = raw.y ?? 0;
        const rz = raw.z ?? 0;
        if (!gv.init) {
          gv.x = rx;
          gv.y = ry;
          gv.z = rz;
          gv.init = true;
        }
        const k = 0.88;
        gv.x = k * gv.x + (1 - k) * rx;
        gv.y = k * gv.y + (1 - k) * ry;
        gv.z = k * gv.z + (1 - k) * rz;
        a = { x: rx - gv.x, y: ry - gv.y, z: rz - gv.z };
      }
      const ax = a.x ?? 0;
      const ay = a.y ?? 0;
      const az = a.z ?? 0;
      const rr = e.rotationRate;
      const rb = Math.abs(rr?.beta ?? 0);
      const rg = Math.abs(rr?.gamma ?? 0);
      const ra = Math.abs(rr?.alpha ?? 0);

      if (!armedRef.current || disabledRef.current) return;

      if (s.state === "idle") {
        if (!tiltRef.current.ok) return;
        if (ay > 2.6) {
          s.state = "rise";
          s.t0 = now;
          s.vx = ax * dt;
          s.vy = ay * dt;
          s.vz = az * dt;
          s.peakV = s.vy;
          s.rollSum = Math.abs(tiltRef.current.gamma);
          s.n = 1;
          setStage("rise");
        }
        return;
      }

      if (s.state === "rise") {
        s.vx += ax * dt;
        s.vy += ay * dt;
        s.vz += az * dt;
        s.peakV = Math.max(s.peakV, s.vy);
        s.rollSum += Math.abs(tiltRef.current.gamma);
        s.yawDrift += (rr?.alpha ?? 0) * dt;
        s.n++;
        if (gaugeRef.current) {
          gaugeRef.current.style.transform = `scaleX(${clamp(s.peakV / (IDEAL_PUSH_V * 1.45))})`;
        }
        if (now - s.t0 > 1.4) {
          setHint("Geste trop long — recommence la montée.");
          reset();
          return;
        }
        if ((ay < -0.5 || s.vy < s.peakV * 0.86) && s.peakV > 0.55) {
          s.state = "await";
          s.tPeak = now;
          setStage("snap");
          buzz(8);
        }
        return;
      }

      // await : on guette le cassé de poignet
      s.rollSum += Math.abs(tiltRef.current.gamma);
      s.n++;
      if (rb > s.snapPeak) {
        s.snapPeak = rb;
        s.snapT = now;
        s.cross = rg + ra * 0.6;
      }
      if (now - s.tPeak > 0.45 || (s.snapPeak > 140 && rb < s.snapPeak * 0.35 && now - s.snapT > 0.06)) {
        fire();
      }
    };
    window.addEventListener("devicemotion", h);
    return () => window.removeEventListener("devicemotion", h);
  }, [perm, fire, reset]);

  // désarmement automatique
  useEffect(() => {
    if (!armed) return;
    const to = setTimeout(() => {
      if (stRef.current.state === "idle") {
        armedRef.current = false;
        setArmed(false);
        setHint("Temps écoulé. Réarme quand tu es prêt.");
      }
    }, 8000);
    return () => clearTimeout(to);
  }, [armed]);

  const enable = async () => {
    const ok = await askSensors();
    setPerm(ok ? "granted" : "denied");
    if (!ok) setHint("Capteurs refusés — bascule sur le geste au doigt.");
  };

  if (perm !== "granted") {
    return (
      <div className="rounded-2xl p-5 space-y-3 text-center" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
        <p className="text-sm" style={{ color: "var(--text-main)" }}>
          {perm === "unsupported"
            ? "Ce navigateur n'expose pas les capteurs de mouvement."
            : "Le tir se fait avec le téléphone lui‑même : montée franche, puis cassé du poignet."}
        </p>
        {perm !== "unsupported" && (
          <button
            onClick={enable}
            className="w-full py-3 rounded-xl text-sm font-semibold active:scale-95 transition-transform"
            style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "#fff" }}
          >
            Autoriser les capteurs
          </button>
        )}
        <button onClick={onFallback} className="text-xs underline" style={{ color: "var(--text-muted)" }}>
          Tirer au doigt à la place
        </button>
        {hint && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{hint}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-4 space-y-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
      <div className="flex items-center gap-4">
        {/* niveau à bulle */}
        <div
          className="relative shrink-0 rounded-full"
          style={{
            width: 104,
            height: 104,
            background: "var(--bg-input)",
            border: `2px solid ${aligned ? "#4ade80" : "var(--border)"}`,
            transition: "border-color .2s",
          }}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-full" style={{ width: 34, height: 34, border: "1px dashed var(--border)" }} />
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              ref={bubbleRef}
              className="rounded-full"
              style={{ width: 16, height: 16, background: "var(--accent)", transition: "background .2s" }}
            />
          </div>
        </div>

        <div className="flex-1 space-y-2">
          <p className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
            {!armed
              ? "Tiens le téléphone droit, écran vers toi."
              : stage === "wait"
              ? aligned
                ? "Prêt. Monte le téléphone d'un geste franc."
                : "Redresse le téléphone pour armer le tir."
              : stage === "rise"
              ? "Monte…"
              : "Casse le poignet !"}
          </p>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
            <div
              ref={gaugeRef}
              className="h-full origin-left"
              style={{
                background: "linear-gradient(90deg,var(--accent),var(--accent2))",
                transform: "scaleX(0)",
                transition: "transform .06s linear",
              }}
            />
          </div>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Poussée mesurée pendant la montée
          </p>
        </div>
      </div>

      <button
        disabled={disabled}
        onClick={() => {
          if (armed) {
            armedRef.current = false;
            setArmed(false);
            reset();
            return;
          }
          setHint(null);
          reset();
          armedRef.current = true;
          setArmed(true);
          buzz(14);
        }}
        className="w-full py-4 rounded-xl text-sm font-semibold active:scale-95 transition-transform disabled:opacity-40"
        style={
          armed
            ? { background: "var(--bg-input)", color: "var(--text-main)", border: "1px solid var(--border)" }
            : { background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "#fff" }
        }
      >
        {armed ? "Annuler" : "Armer le tir"}
      </button>

      <div className="flex items-center justify-between">
        {hint ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{hint}</p>
        ) : (
          <span />
        )}
        <button onClick={onFallback} className="text-xs underline shrink-0" style={{ color: "var(--text-muted)" }}>
          Passer au doigt
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   5. SOURIS / DOIGT — même geste, transposé au tracé
   Montée rectiligne, puis rupture de direction rapide au sommet.
   ═══════════════════════════════════════════════════════════════════════════ */

const IDEAL_STROKE = 4.4; // hauteurs de zone par seconde
const STROKE_TOL = 2.8;
const IDEAL_TURN = 620; // °/s de rupture de direction
const TURN_TOL = 460;

interface StrokePt {
  x: number;
  y: number;
  t: number;
}

function PointerController({
  disabled,
  onShot,
  onSwitch,
  canSwitch,
}: {
  disabled: boolean;
  onShot: (m: GestureMetrics) => void;
  onSwitch: () => void;
  canSwitch: boolean;
}) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const ptsRef = useRef<StrokePt[]>([]);
  const [trail, setTrail] = useState<{ x: number; y: number }[]>([]);
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<"idle" | "rise" | "snap">("idle");
  const [tooShort, setTooShort] = useState(false);

  const analyse = () => {
    const pts = ptsRef.current;
    const zone = zoneRef.current;
    if (!zone || pts.length < 4) return null;
    const Hh = zone.clientHeight || 1;

    // sommet = point le plus haut atteint
    let apex = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i].y < pts[apex].y) apex = i;
    if (apex < 2) return null;

    const first = pts[0];
    const top = pts[apex];
    const riseDt = Math.max(0.05, (top.t - first.t) / 1000);
    const riseDy = (first.y - top.y) / Hh;
    if (riseDy < 0.25) return null;
    const strokeSpeed = riseDy / riseDt;

    // axe : dérive horizontale pendant la montée
    let maxDev = 0;
    for (let i = 0; i <= apex; i++) maxDev = Math.max(maxDev, Math.abs(pts[i].x - first.x));
    const lateralDeg = (Math.atan2(top.x - first.x, Math.max(20, first.y - top.y)) * 180) / Math.PI;
    const axis = clamp(1 - maxDev / (Hh * 0.35));

    // cassé : rupture de direction après le sommet
    const dirAt = (i0: number, i1: number) => {
      const a = pts[Math.max(0, i0)];
      const b = pts[Math.min(pts.length - 1, i1)];
      return { x: b.x - a.x, y: b.y - a.y, dt: Math.max(16, b.t - a.t) };
    };
    const before = dirAt(apex - 3, apex);
    const after = dirAt(apex, pts.length - 1);
    const mag = (v: { x: number; y: number }) => Math.hypot(v.x, v.y) || 1;
    const cosang = (before.x * after.x + before.y * after.y) / (mag(before) * mag(after));
    const turn = (Math.acos(clamp(cosang, -1, 1)) * 180) / Math.PI;
    const afterLen = mag(after);
    const turnRate = afterLen < Hh * 0.05 ? 0 : (turn / after.dt) * 1000;

    const tailDt = (pts[pts.length - 1].t - top.t) / 1000;
    const timing = clamp(1 - Math.abs(tailDt - 0.13) / 0.26);

    return {
      push: clamp((strokeSpeed - IDEAL_STROKE) / STROKE_TOL, -1, 1),
      snap: clamp((turnRate - IDEAL_TURN) / TURN_TOL, -1, 1),
      lateral: clamp(lateralDeg / 14, -1, 1),
      axis,
      timing,
      source: "pointer" as const,
    };
  };

  const start = (e: React.PointerEvent) => {
    if (disabled) return;
    const r = zoneRef.current?.getBoundingClientRect();
    if (!r) return;
    setTooShort(false);
    ptsRef.current = [{ x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() }];
    setTrail([{ x: e.clientX - r.left, y: e.clientY - r.top }]);
    setActive(true);
    setPhase("rise");
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent) => {
    if (!active) return;
    const r = zoneRef.current?.getBoundingClientRect();
    if (!r) return;
    const p = { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
    const pts = ptsRef.current;
    const last = pts[pts.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 3) return;
    pts.push(p);
    if (pts.length > 160) pts.shift();
    setTrail((prev) => [...prev.slice(-70), { x: p.x, y: p.y }]);
    let apexY = Infinity;
    for (const q of pts) apexY = Math.min(apexY, q.y);
    setPhase(p.y > apexY + 12 ? "snap" : "rise");
  };

  const end = () => {
    if (!active) return;
    setActive(false);
    setPhase("idle");
    const m = analyse();
    setTimeout(() => setTrail([]), 220);
    setTooShort(!m);
    if (m) onShot(m);
  };

  const H = 260;
  return (
    <div className="space-y-2">
      <div
        ref={zoneRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="relative rounded-2xl overflow-hidden select-none"
        style={{
          height: H,
          touchAction: "none",
          cursor: disabled ? "default" : "crosshair",
          background: "var(--bg-card)",
          border: `1px solid ${active ? "transparent" : "var(--border-card)"}`,
          outline: active ? "2px solid var(--accent)" : "none",
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
          <line x1="50%" y1="12%" x2="50%" y2="88%" stroke="var(--border)" strokeWidth="1" strokeDasharray="4 7" />
          <circle cx="50%" cy="86%" r="16" fill="none" stroke="var(--border)" strokeWidth="1" />
          {trail.length > 1 && (
            <polyline
              points={trail.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.85"
            />
          )}
        </svg>
        <div className="absolute inset-x-0 bottom-0 p-4 text-center">
          <p className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
            {phase === "idle"
              ? tooShort
                ? "Geste trop court : remonte sur au moins un tiers de la zone."
                : "Pars du bas, remonte droit, casse net au sommet."
              : phase === "rise"
              ? "Monte…"
              : "Casse !"}
          </p>
        </div>
      </div>
      {canSwitch && (
        <button onClick={onSwitch} className="text-xs underline" style={{ color: "var(--text-muted)" }}>
          Revenir au tir aux capteurs
        </button>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   6. JEU
   ═══════════════════════════════════════════════════════════════════════════ */

interface Tally {
  attempts: number;
  makes: number;
  best: number;
}

const OUTCOME_LABEL: Record<Outcome, string> = {
  swish: "Swish",
  made: "Panier",
  rimout: "Sur l'arceau",
  miss: "Raté",
};

function LancerFrancGame({ ctx }: { ctx: RoomContext }) {
  const solo = ctx.role === "solo";
  const isHost = ctx.role === "host" || solo;

  const [mode, setMode] = useState<"motion" | "pointer">("pointer");
  const [diff, setDiff] = useState<Difficulty>(DIFFICULTIES[0]);
  const [shot, setShot] = useState<SimResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<SimResult | null>(null);
  const [stats, setStats] = useState({ attempts: 0, makes: 0, streak: 0, best: 0 });
  const [tally, setTally] = useState<Record<string, Tally>>({});
  const [showHelp, setShowHelp] = useState(false);
  const idRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    const hasMotion = typeof window.DeviceMotionEvent !== "undefined";
    if (coarse && hasMotion) setMode("motion");
  }, []);

  const recordShot = useCallback(
    (playerId: string, made: boolean, streak: number) => {
      setTally((prev) => {
        const e = prev[playerId] ?? { attempts: 0, makes: 0, best: 0 };
        const next = {
          ...prev,
          [playerId]: {
            attempts: e.attempts + 1,
            makes: e.makes + (made ? 1 : 0),
            best: Math.max(e.best, streak),
          },
        };
        if (isHost) ctx.broadcast({ type: "state", payload: next });
        return next;
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [isHost]
  );

  useEffect(() => {
    ctx.onMessage((msg: NetMessage, from?: string) => {
      if (msg.type === "state" && !isHost) {
        setTally(msg.payload as Record<string, Tally>);
      }
      if (msg.type === "move" && isHost && from) {
        const p = msg.payload as { made: boolean; streak?: number };
        recordShot(from, p.made, p.streak ?? 0);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, recordShot]);

  const handleGesture = (m: GestureMetrics) => {
    if (busy) return;
    const { params, grade } = buildShot(m, diff);
    const sim = simulate(params);
    idRef.current += 1;
    setLast(null);
    setShot({ ...sim, id: idRef.current, grade });
    setBusy(true);
  };

  const handleDone = (s: SimResult) => {
    const made = s.outcome === "swish" || s.outcome === "made";
    let nextStreak = 0;
    setStats((prev) => {
      nextStreak = made ? prev.streak + 1 : 0;
      return {
        attempts: prev.attempts + 1,
        makes: prev.makes + (made ? 1 : 0),
        streak: nextStreak,
        best: Math.max(prev.best, nextStreak),
      };
    });
    if (!solo) {
      if (isHost) recordShot(ctx.myId, made, nextStreak);
      else ctx.send({ type: "move", payload: { made, streak: nextStreak }, from: ctx.myId });
    }
    buzz(made ? [10, 30, 10] : 30);
    setLast(s);
    setBusy(false);
  };

  const pct = stats.attempts > 0 ? Math.round((stats.makes / stats.attempts) * 100) : 0;
  const made = last && (last.outcome === "swish" || last.outcome === "made");

  return (
    <div className="space-y-4">
      <style>{`
        @keyframes lf-pop { 0%{opacity:0;transform:translateY(6px) scale(.94)} 60%{opacity:1;transform:translateY(0) scale(1.02)} 100%{opacity:1;transform:none} }
        .lf-pop { animation: lf-pop .32s cubic-bezier(.2,.8,.3,1) both; }
        @media (prefers-reduced-motion: reduce) { .lf-pop { animation: none; } }
      `}</style>

      <div className="relative">
        <CourtCanvas shot={shot} onDone={handleDone} aimHint={0} />

        {/* HUD série */}
        {stats.streak >= 3 && (
          <div
            className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-xs font-semibold lf-pop"
            style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "#fff" }}
          >
            {stats.streak} d'affilée 🔥
          </div>
        )}

        {last && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center px-3">
            <div
              className="lf-pop rounded-xl px-4 py-2.5 text-center backdrop-blur"
              style={{
                background: "rgba(8,12,22,0.78)",
                border: `1px solid ${made ? "rgba(74,222,128,.55)" : "rgba(248,113,113,.45)"}`,
                minWidth: 200,
              }}
            >
              <p
                className="font-display text-lg leading-none"
                style={{ color: made ? "#4ade80" : "#f87171" }}
              >
                {OUTCOME_LABEL[last.outcome]}
              </p>
              <p className="text-[11px] mt-1" style={{ color: "rgba(233,238,248,.72)" }}>
                {last.detail}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Stat label="Tirs" value={stats.attempts} />
        <Stat label="Réussite" value={`${pct}%`} />
        <Stat label="Série" value={stats.streak} />
        <Stat label="Record" value={stats.best} />
      </div>

      {last && (
        <div
          className="rounded-2xl p-3 grid grid-cols-3 gap-3"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
        >
          <Bar label="Poussée" v={last.grade.push} />
          <Bar label="Poignet" v={last.grade.snap} />
          <Bar label="Axe" v={last.grade.axis} />
        </div>
      )}

      {mode === "motion" ? (
        <MotionController disabled={busy} onShot={handleGesture} onFallback={() => setMode("pointer")} />
      ) : (
        <PointerController
          disabled={busy}
          onShot={handleGesture}
          canSwitch={typeof window !== "undefined" && typeof window.DeviceMotionEvent !== "undefined"}
          onSwitch={() => setMode("motion")}
        />
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: "var(--bg-input)" }}>
          {DIFFICULTIES.map((d) => (
            <button
              key={d.key}
              onClick={() => setDiff(d)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={
                d.key === diff.key
                  ? { background: "var(--accent)", color: "#fff" }
                  : { color: "var(--text-muted)" }
              }
            >
              {d.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowHelp((v) => !v)}
          className="text-xs underline"
          style={{ color: "var(--text-muted)" }}
        >
          {showHelp ? "Masquer le geste" : "Comment tirer ?"}
        </button>
      </div>

      {showHelp && (
        <ol
          className="rounded-2xl p-4 space-y-2 text-sm lf-pop"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
        >
          <li>
            <span style={{ color: "var(--text-main)" }}>Tiens l'axe.</span>{" "}
            {mode === "motion"
              ? "Téléphone droit, écran vers toi : la bulle doit rester au centre, sinon le ballon part sur le côté."
              : "Le tracé doit suivre la ligne centrale ; toute dérive latérale se retrouve sur le tir."}
          </li>
          <li>
            <span style={{ color: "var(--text-main)" }}>Monte.</span>{" "}
            {mode === "motion"
              ? "Une poussée nette vers le haut : c'est elle qui donne la distance."
              : "Un trait vers le haut, franc et régulier : c'est lui qui donne la distance."}
          </li>
          <li>
            <span style={{ color: "var(--text-main)" }}>Casse le poignet.</span>{" "}
            {mode === "motion"
              ? "Au sommet, bascule le téléphone vers l'avant d'un coup sec. Trop peu : tir tendu qui tape le cercle. Trop fort : cloche trop haute et trop courte."
              : "Au sommet, rupture nette de direction. Trop peu : tir tendu. Trop fort : cloche trop haute."}
          </li>
        </ol>
      )}

      {!solo && (
        <div className="rounded-2xl p-3 space-y-2" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <p className="text-[11px]" style={{ color: "var(--text-sub)" }}>
            Concours de lancers francs
          </p>
          {ctx.players
            .map((p) => ({ p, t: tally[p.id] ?? { attempts: 0, makes: 0, best: 0 } }))
            .sort((a, b) => b.t.makes - a.t.makes || b.t.best - a.t.best)
            .map(({ p, t }, i) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span style={{ color: "var(--text-main)" }}>
                  {i === 0 && t.makes > 0 ? "🏆 " : ""}
                  {p.name}
                  {p.id === ctx.myId ? " (toi)" : ""}
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  {t.makes}/{t.attempts}
                  {t.best > 1 ? ` · série ${t.best}` : ""}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center rounded-xl py-2" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
      <p className="font-display text-xl leading-none" style={{ color: "var(--accent)" }}>
        {value}
      </p>
      <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
    </div>
  );
}

function Bar({ label, v }: { label: string; v: number }) {
  const pct = Math.round(clamp(v) * 100);
  const col = pct > 80 ? "#4ade80" : pct > 55 ? "var(--accent)" : "#f87171";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px]">
        <span style={{ color: "var(--text-muted)" }}>{label}</span>
        <span style={{ color: "var(--text-main)" }}>{pct}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: col, transition: "width .4s" }} />
      </div>
    </div>
  );
}

export default function LancerFranc() {
  return (
    <RoomConnect gameName="Lancer franc" minPlayers={1}>
      {(ctx) => <LancerFrancGame ctx={ctx} />}
    </RoomConnect>
  );
}
