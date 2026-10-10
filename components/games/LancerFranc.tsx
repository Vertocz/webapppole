"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RoomConnect, { RoomContext } from "./RoomConnect";
import type { NetMessage } from "@/lib/p2pRoom";
import {
  MIN_ATTEMPTS_RECORD,
  fetchRecordman,
  getIdentity,
  loadLocalStats,
  mergeStats,
  pullMyStats,
  pushStats,
  saveLocalStats,
  type LFIdentity,
  type LFStats,
  type Recordman,
} from "@/lib/lancerFrancStats";

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
  source: "motion";
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
  { key: "arcade", label: "Souple", dead: 0.55, power: 0.024, lateral: 3.0, angle: 10 },
  { key: "pro", label: "Réaliste", dead: 0.25, power: 0.032, lateral: 4.5, angle: 14 },
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
  const latE = soften(m.lateral, d.dead);

  // Le poignet donne l'angle, la montée donne la vitesse. Le tireur compense
  // spontanément une partie de son erreur d'angle : au-delà, la balle est
  // trop courte (tir trop tendu) ou trop longue (cloche démesurée).
  const angleDeg = BASE_ANGLE + snapE * d.angle + gauss(0.5);
  // Trop long pardonne naturellement plus que trop court (planche, cercle
  // arrière) : on rééquilibre pour que les deux fautes se valent.
  const powerScale = d.power * (pushE > 0 ? 1.3 : 1);
  let speed = idealSpeed(BASE_ANGLE + ANGLE_COMP * (angleDeg - BASE_ANGLE)) * (1 + pushE * powerScale);
  speed *= 1 - 0.006 * (1 - m.timing); // désynchro montée / poignet
  speed *= 1 + gauss(0.0025); // main humaine

  const lateralDeg = latE * d.lateral + gauss(0.2 + (1 - m.axis) * 0.6);

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
}: {
  shot: SimResult | null;
  onDone: (s: SimResult) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shotRef = useRef<SimResult | null>(null);
  const startRef = useRef(0);
  const firedRef = useRef(true);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

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
      H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
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
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />;
}

/* ════════════════════════════════════════════════════════════════════════════
   4. CAPTEURS — le téléphone EST le ballon
   Pas de bouton « armer » : dès que le téléphone est tenu droit, chaque geste
   (montée franche puis cassé de poignet) déclenche un tir. Il n'y a rien à
   calibrer : l'indicateur « Prêt » passe au vert quand l'orientation est bonne.
   ═══════════════════════════════════════════════════════════════════════════ */

const IDEAL_PUSH_V = 2.0; // m/s au sommet de la montée
const PUSH_TOL = 1.1;
const IDEAL_SNAP = 430; // °/s au pic de rotation
const SNAP_TOL = 320;
const IDEAL_DELAY = 0.11; // s entre fin de montée et cassé
const DELAY_TOL = 0.22;
const TARGET_BETA = 74; // téléphone tenu quasi vertical, écran vers soi
// Entrée « Prêt » : zone confortable. Sortie : zone bien plus large (hystérésis)
// + délai, pour que le voyant ne clignote pas quand la main bouge un peu.
const BETA_IN = 34;
const GAMMA_IN = 26;
const BETA_OUT = 48;
const GAMMA_OUT = 38;
const TILT_LOSS_MS = 350;
const COOLDOWN_S = 0.8; // ignore le mouvement de retour après un tir

// Biais latéral personnel (ex. droitier dont le geste part toujours à droite) :
// moyenne glissante du côté où part le geste, retranchée automatiquement.
const BIAS_KEY = "lf-lateral-bias";
const BIAS_RATE = 0.3;
const BIAS_MAX = 0.7;
function loadBias(): number {
  try {
    const v = parseFloat(localStorage.getItem(BIAS_KEY) ?? "0");
    return Number.isFinite(v) ? clamp(v, -BIAS_MAX, BIAS_MAX) : 0;
  } catch {
    return 0;
  }
}
function saveBias(v: number) {
  try {
    localStorage.setItem(BIAS_KEY, String(v));
  } catch {
    /* ignoré */
  }
}

type Perm = "checking" | "ask" | "granted" | "denied" | "nosensor";

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

function useShotSensor(onShot: (m: GestureMetrics) => void) {
  const [perm, setPerm] = useState<Perm>("checking");
  const [stage, setStage] = useState<"wait" | "rise" | "snap">("wait");
  const [aligned, setAligned] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const gaugeRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef({ beta: TARGET_BETA, gamma: 0, ok: false });
  const cooldownRef = useRef(0);
  const tiltLostRef = useRef(0);
  const biasRef = useRef(0);
  const onShotRef = useRef(onShot);
  onShotRef.current = onShot;

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
    rollSum: 0,
    yawDrift: 0,
    n: 0,
    last: 0,
  });

  // Autorisation : seul iOS demande un clic ; ailleurs les capteurs sont libres.
  useEffect(() => {
    if (typeof window === "undefined") return;
    biasRef.current = loadBias();
    if (typeof window.DeviceMotionEvent === "undefined") {
      setPerm("nosensor");
      return;
    }
    const DM = window.DeviceMotionEvent as unknown as { requestPermission?: unknown };
    setPerm(typeof DM.requestPermission === "function" ? "ask" : "granted");
  }, []);

  const enable = useCallback(async () => {
    const ok = await askSensors();
    setPerm(ok ? "granted" : "denied");
  }, []);

  // Ordinateur sans capteur : l'événement existe mais ne contient rien.
  useEffect(() => {
    if (perm !== "granted") return;
    let seen = false;
    const probe = (e: DeviceMotionEvent) => {
      if (
        e.accelerationIncludingGravity?.x != null ||
        e.acceleration?.x != null ||
        e.rotationRate?.beta != null
      )
        seen = true;
    };
    window.addEventListener("devicemotion", probe);
    const to = setTimeout(() => {
      if (!seen) setPerm("nosensor");
    }, 2500);
    return () => {
      window.removeEventListener("devicemotion", probe);
      clearTimeout(to);
    };
  }, [perm]);

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
    // La rotation autour de l'axe de l'écran pesait trop lourd : elle poussait
    // systématiquement le tir du même côté. On la garde, mais bien plus légère.
    const rawLateral = clamp(((lateralRad * 180) / Math.PI) / 5.5 + s.yawDrift / 40, -1.5, 1.5);
    const lateral = clamp(rawLateral - biasRef.current, -1, 1);
    biasRef.current = clamp(
      biasRef.current + BIAS_RATE * (rawLateral - biasRef.current),
      -BIAS_MAX,
      BIAS_MAX
    );
    saveBias(biasRef.current);

    cooldownRef.current = performance.now() / 1000 + COOLDOWN_S;
    reset();
    buzz(s.snapPeak > 200 ? [12, 40, 22] : 18);
    onShotRef.current({ push, snap, lateral, axis, timing, source: "motion" });
  }, [reset]);

  // Orientation : sert uniquement à savoir si le téléphone est bien tenu.
  useEffect(() => {
    if (perm !== "granted") return;
    const h = (e: DeviceOrientationEvent) => {
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;
      const db = Math.abs(beta - TARGET_BETA);
      const dg = Math.abs(gamma);
      const t = tiltRef.current;
      const nowMs = performance.now();
      let ok = t.ok;
      if (!t.ok) {
        if (db < BETA_IN && dg < GAMMA_IN) {
          ok = true;
          tiltLostRef.current = 0;
        }
      } else if (db >= BETA_OUT || dg >= GAMMA_OUT) {
        // on ne perd le « Prêt » qu'après un moment hors zone
        if (!tiltLostRef.current) tiltLostRef.current = nowMs;
        if (nowMs - tiltLostRef.current > TILT_LOSS_MS) ok = false;
      } else {
        tiltLostRef.current = 0;
      }
      tiltRef.current = { beta, gamma, ok };
      setAligned((prev) => (prev === ok ? prev : ok));
    };
    window.addEventListener("deviceorientation", h);
    return () => window.removeEventListener("deviceorientation", h);
  }, [perm]);

  // Mouvement : détection montée → cassé de poignet, en continu.
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

      if (s.state === "idle") {
        if (now < cooldownRef.current) return;
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
          setHint(null);
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
          setHint("Geste trop long, recommence.");
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

  // Les messages d'aide s'effacent seuls
  useEffect(() => {
    if (!hint) return;
    const to = setTimeout(() => setHint(null), 2500);
    return () => clearTimeout(to);
  }, [hint]);

  return { perm, enable, stage, aligned, hint, gaugeRef };
}

/* ════════════════════════════════════════════════════════════════════════════
   5. JEU
   ═══════════════════════════════════════════════════════════════════════════ */

const OUTCOME_LABEL: Record<Outcome, string> = {
  swish: "Swish",
  made: "Panier",
  rimout: "Sur l'arceau",
  miss: "Raté",
};

interface Tally {
  attempts: number;
  makes: number;
  best: number;
}

const isMade = (s: SimResult) => s.outcome === "swish" || s.outcome === "made";

function LancerFrancGame({ ctx }: { ctx: RoomContext }) {
  const solo = ctx.role === "solo";
  const isHost = ctx.role === "host" || solo;

  const who = useMemo<LFIdentity>(
    () => (typeof window === "undefined" ? { id: "local", label: "Moi" } : getIdentity()),
    []
  );

  const [diff, setDiff] = useState<Difficulty>(DIFFICULTIES[0]);
  const [shot, setShot] = useState<SimResult | null>(null);
  const [last, setLast] = useState<SimResult | null>(null);
  const [toast, setToast] = useState(false);
  const [streak, setStreak] = useState(0);
  const [all, setAll] = useState<LFStats>(() =>
    typeof window === "undefined" ? { makes: 0, attempts: 0, best: 0 } : loadLocalStats(who.id)
  );
  const [record, setRecord] = useState<Recordman | null>(null);
  const [tally, setTally] = useState<Record<string, Tally>>({});
  const [panel, setPanel] = useState<"none" | "help" | "room">("none");
  const [boxH, setBoxH] = useState(520);

  const rootRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  const shotRef = useRef<SimResult | null>(null);
  const committedRef = useRef(0);
  const streakRef = useRef(0);
  const allRef = useRef(all);
  const dirtyRef = useRef(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Tient tout dans l'écran : la zone de jeu occupe la hauteur restante.
  useEffect(() => {
    const fit = () => {
      const el = rootRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      setBoxH(Math.max(340, Math.round(vh - top - 36)));
    };
    window.scrollTo(0, 0);
    const raf = requestAnimationFrame(fit);
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, []);

  // ── Garde l'écran allumé tant qu'on joue (Wake Lock)
  useEffect(() => {
    type Lock = { release: () => Promise<void>; addEventListener: (t: "release", cb: () => void) => void };
    const wl = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<Lock> } }).wakeLock;
    if (!wl) return;
    let lock: Lock | null = null;
    let gone = false;
    const acquire = async () => {
      if (gone || lock || document.visibilityState !== "visible") return;
      try {
        const l = await wl.request("screen");
        if (gone) {
          l.release().catch(() => {});
          return;
        }
        lock = l;
        l.addEventListener("release", () => {
          if (lock === l) lock = null;
        });
      } catch {
        /* refusé (économie d'énergie, pas d'activation) : on réessaiera */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pointerdown", acquire); // certains navigateurs exigent un geste
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointerdown", acquire);
      lock?.release().catch(() => {});
    };
  }, []);

  // ── Stats de tout le temps : local d'abord, serveur quand il y a du réseau
  const flush = useCallback(async () => {
    clearTimeout(syncTimer.current);
    if (dirtyRef.current) {
      const ok = await pushStats(who, allRef.current);
      if (ok) dirtyRef.current = false;
    }
    setRecord(await fetchRecordman(who, allRef.current));
  }, [who]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = await pullMyStats(who);
      if (cancelled) return;
      if (remote) {
        const merged = mergeStats(allRef.current, remote);
        if (merged.attempts !== remote.attempts || merged.best !== remote.best) dirtyRef.current = true;
        allRef.current = merged;
        setAll(merged);
        saveLocalStats(who.id, merged);
      }
      flush();
    })();
    const onHide = () => {
      if (document.visibilityState === "hidden" && dirtyRef.current) pushStats(who, allRef.current);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onHide);
      clearTimeout(syncTimer.current);
      clearTimeout(toastTimer.current);
      if (dirtyRef.current) pushStats(who, allRef.current);
    };
  }, [who, flush]);

  // ── Concours en salle (multijoueur)
  const recordShot = useCallback(
    (playerId: string, made: boolean, streakNow: number) => {
      setTally((prev) => {
        const e = prev[playerId] ?? { attempts: 0, makes: 0, best: 0 };
        const next = {
          ...prev,
          [playerId]: {
            attempts: e.attempts + 1,
            makes: e.makes + (made ? 1 : 0),
            best: Math.max(e.best, streakNow),
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
      if (msg.type === "state" && !isHost) setTally(msg.payload as Record<string, Tally>);
      if (msg.type === "move" && isHost && from) {
        const p = msg.payload as { made: boolean; streak?: number };
        recordShot(from, p.made, p.streak ?? 0);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, recordShot]);

  // ── Résultat d'un tir : compté une seule fois, même si on enchaîne
  const commit = (s: SimResult) => {
    if (committedRef.current >= s.id) return;
    committedRef.current = s.id;
    const made = isMade(s);

    streakRef.current = made ? streakRef.current + 1 : 0;
    setStreak(streakRef.current);

    const next: LFStats = {
      makes: allRef.current.makes + (made ? 1 : 0),
      attempts: allRef.current.attempts + 1,
      best: Math.max(allRef.current.best, streakRef.current),
    };
    allRef.current = next;
    dirtyRef.current = true;
    setAll(next);
    saveLocalStats(who.id, next);
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(flush, 2500);

    if (!solo) {
      if (isHost) recordShot(ctx.myId, made, streakRef.current);
      else ctx.send({ type: "move", payload: { made, streak: streakRef.current }, from: ctx.myId });
    }

    buzz(made ? [10, 30, 10] : 30);
    setLast(s);
    setToast(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(false), 2600);
  };

  // ── Chaque geste = un nouveau tir (le précédent est validé immédiatement s'il volait encore)
  const handleGesture = (m: GestureMetrics) => {
    if (shotRef.current) commit(shotRef.current);
    const { params, grade } = buildShot(m, diff);
    const sim = simulate(params);
    idRef.current += 1;
    const full: SimResult = { ...sim, id: idRef.current, grade };
    shotRef.current = full;
    setToast(false);
    setShot(full);
  };

  const sensor = useShotSensor(handleGesture);

  const pct = all.attempts > 0 ? Math.round((all.makes / all.attempts) * 100) : 0;
  const made = last ? isMade(last) : false;
  const ready = sensor.perm === "granted";

  const chipText =
    sensor.hint ??
    (sensor.stage === "rise"
      ? "Monte…"
      : sensor.stage === "snap"
      ? "Casse le poignet !"
      : sensor.aligned
      ? "Prêt : monte, puis casse le poignet"
      : "Tiens le téléphone droit, écran vers toi");
  const chipOk = sensor.stage !== "wait" || sensor.aligned;

  return (
    <div ref={rootRef} className="flex flex-col gap-2" style={{ height: boxH }}>
      <style>{`
        @keyframes lf-pop { 0%{opacity:0;transform:translateY(6px) scale(.94)} 60%{opacity:1;transform:translateY(0) scale(1.02)} 100%{opacity:1;transform:none} }
        .lf-pop { animation: lf-pop .32s cubic-bezier(.2,.8,.3,1) both; }
        @media (prefers-reduced-motion: reduce) { .lf-pop { animation: none; } }
      `}</style>

      {/* ── Terrain ── */}
      <div
        className="relative flex-1 min-h-0 rounded-2xl overflow-hidden"
        style={{ border: "1px solid var(--border-card)" }}
      >
        <CourtCanvas
          shot={shot}
          onDone={(s) => {
            commit(s);
          }}
        />

        {/* commandes discrètes */}
        <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-2">
          <div className="flex gap-1.5">
            <button
              onClick={() => setDiff(diff.key === "arcade" ? DIFFICULTIES[1] : DIFFICULTIES[0])}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium backdrop-blur"
              style={{ background: "rgba(8,12,22,0.7)", color: "#E9EEF8", border: "1px solid rgba(255,255,255,.12)" }}
            >
              {diff.label}
            </button>
            <button
              onClick={() => setPanel(panel === "help" ? "none" : "help")}
              aria-label="Comment tirer ?"
              className="w-7 h-7 rounded-full text-xs font-semibold backdrop-blur"
              style={{ background: "rgba(8,12,22,0.7)", color: "#E9EEF8", border: "1px solid rgba(255,255,255,.12)" }}
            >
              ?
            </button>
            {!solo && (
              <button
                onClick={() => setPanel(panel === "room" ? "none" : "room")}
                aria-label="Classement de la partie"
                className="w-7 h-7 rounded-full text-xs backdrop-blur"
                style={{ background: "rgba(8,12,22,0.7)", color: "#E9EEF8", border: "1px solid rgba(255,255,255,.12)" }}
              >
                👥
              </button>
            )}
          </div>
          {streak >= 3 && (
            <div
              className="px-2.5 py-1 rounded-full text-xs font-semibold lf-pop"
              style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "#fff" }}
            >
              {streak} d'affilée 🔥
            </div>
          )}
        </div>

        {/* état du capteur */}
        {ready && (
          <div className="absolute top-11 inset-x-0 flex justify-center px-3 pointer-events-none">
            <div
              className="rounded-xl px-3 py-1.5 text-center backdrop-blur"
              style={{
                background: "rgba(8,12,22,0.72)",
                border: `1px solid ${chipOk ? "rgba(74,222,128,.5)" : "rgba(251,191,36,.45)"}`,
                minWidth: 190,
              }}
            >
              <p className="text-xs font-medium" style={{ color: chipOk ? "#86efac" : "#fcd34d" }}>
                {chipText}
              </p>
              <div className="h-[3px] rounded-full overflow-hidden mt-1.5" style={{ background: "rgba(255,255,255,.1)" }}>
                <div
                  ref={sensor.gaugeRef}
                  className="h-full origin-left"
                  style={{
                    background: "linear-gradient(90deg,var(--accent),var(--accent2))",
                    transform: "scaleX(0)",
                    transition: "transform .06s linear",
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* résultat du tir */}
        {last && toast && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center px-3 pointer-events-none">
            <div
              className="lf-pop rounded-xl px-4 py-2.5 text-center backdrop-blur"
              style={{
                background: "rgba(8,12,22,0.8)",
                border: `1px solid ${made ? "rgba(74,222,128,.55)" : "rgba(248,113,113,.45)"}`,
                minWidth: 220,
              }}
            >
              <p className="font-display text-lg leading-none" style={{ color: made ? "#4ade80" : "#f87171" }}>
                {OUTCOME_LABEL[last.outcome]}
              </p>
              <p className="text-[11px] mt-1" style={{ color: "rgba(233,238,248,.72)" }}>
                {last.detail}
              </p>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <Bar label="Poussée" v={last.grade.push} />
                <Bar label="Poignet" v={last.grade.snap} />
                <Bar label="Axe" v={last.grade.axis} />
              </div>
            </div>
          </div>
        )}

        {/* aide */}
        {panel === "help" && (
          <ol
            onClick={() => setPanel("none")}
            className="absolute inset-x-3 top-12 rounded-2xl p-4 space-y-2 text-sm lf-pop backdrop-blur"
            style={{ background: "rgba(8,12,22,0.92)", border: "1px solid var(--border-card)", color: "rgba(233,238,248,.72)" }}
          >
            <li>
              <span style={{ color: "#E9EEF8" }}>Tiens-le droit.</span> Écran vers toi, comme un ballon devant le visage. Le voyant passe à « Prêt ».
            </li>
            <li>
              <span style={{ color: "#E9EEF8" }}>Monte.</span> Une poussée nette vers le haut : elle donne la distance.
            </li>
            <li>
              <span style={{ color: "#E9EEF8" }}>Casse le poignet.</span> Bascule le haut du téléphone vers l'avant d'un coup sec. Trop peu : tir tendu. Trop fort : cloche trop haute.
            </li>
            <li className="text-[11px] pt-1">Chaque geste lance un nouveau tir. Touche pour fermer.</li>
          </ol>
        )}

        {/* classement de la partie */}
        {panel === "room" && !solo && (
          <div
            onClick={() => setPanel("none")}
            className="absolute inset-x-3 top-12 rounded-2xl p-3 space-y-2 lf-pop backdrop-blur"
            style={{ background: "rgba(8,12,22,0.92)", border: "1px solid var(--border-card)" }}
          >
            <p className="text-[11px]" style={{ color: "var(--text-sub)" }}>
              Concours de lancers francs (cette partie)
            </p>
            {ctx.players
              .map((p) => ({ p, t: tally[p.id] ?? { attempts: 0, makes: 0, best: 0 } }))
              .sort((a, b) => b.t.makes - a.t.makes || b.t.best - a.t.best)
              .map(({ p, t }, i) => (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <span style={{ color: "#E9EEF8" }}>
                    {i === 0 && t.makes > 0 ? "🏆 " : ""}
                    {p.name}
                    {p.id === ctx.myId ? " (toi)" : ""}
                  </span>
                  <span style={{ color: "rgba(233,238,248,.6)" }}>
                    {t.makes}/{t.attempts}
                    {t.best > 1 ? ` · série ${t.best}` : ""}
                  </span>
                </div>
              ))}
          </div>
        )}

        {/* autorisation / capteurs indisponibles */}
        {!ready && (
          <div
            className="absolute inset-0 flex items-center justify-center p-6"
            style={{ background: "rgba(5,8,15,0.8)" }}
          >
            <div className="text-center space-y-3 max-w-xs">
              <p className="text-3xl">📱🏀</p>
              {sensor.perm === "nosensor" ? (
                <>
                  <p className="text-sm font-medium" style={{ color: "#E9EEF8" }}>
                    Aucun capteur de mouvement détecté.
                  </p>
                  <p className="text-xs" style={{ color: "rgba(233,238,248,.6)" }}>
                    Ce jeu se joue en bougeant le téléphone. Ouvre-le depuis ton mobile (Chrome ou Safari à jour, en HTTPS).
                  </p>
                </>
              ) : sensor.perm === "denied" ? (
                <>
                  <p className="text-sm font-medium" style={{ color: "#E9EEF8" }}>
                    Accès aux capteurs refusé.
                  </p>
                  <p className="text-xs" style={{ color: "rgba(233,238,248,.6)" }}>
                    Autorise « Mouvement et orientation » pour ce site dans les réglages du navigateur, puis réessaie.
                  </p>
                  <button
                    onClick={sensor.enable}
                    className="w-full py-3 rounded-xl text-sm font-semibold active:scale-95 transition-transform"
                    style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "#fff" }}
                  >
                    Réessayer
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium" style={{ color: "#E9EEF8" }}>
                    Le téléphone devient le ballon : monte, puis casse le poignet.
                  </p>
                  <button
                    onClick={sensor.enable}
                    disabled={sensor.perm === "checking"}
                    className="w-full py-3 rounded-xl text-sm font-semibold active:scale-95 transition-transform disabled:opacity-40"
                    style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "#fff" }}
                  >
                    Activer les capteurs
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Stats de tout le temps ── */}
      <div className="grid grid-cols-3 gap-2 shrink-0">
        <StatTile label="Réussis / tentés" value={`${all.makes}/${all.attempts}`} sub={`${pct}%`} />
        <StatTile label="Série max" value={String(all.best)} sub={streak > 0 ? `en cours : ${streak}` : "—"} />
        <StatTile
          label="Recordman"
          value={record ? record.label : "—"}
          sub={
            record
              ? `${Math.round(record.pct * 100)}% · série ${record.best}`
              : `min. ${MIN_ATTEMPTS_RECORD} tirs`
          }
          small
        />
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  small,
}: {
  label: string;
  value: string;
  sub: string;
  small?: boolean;
}) {
  return (
    <div
      className="text-center rounded-xl py-2 px-1 min-w-0"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
    >
      <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p
        className={`font-display leading-tight truncate ${small ? "text-base" : "text-xl"}`}
        style={{ color: "var(--accent)" }}
      >
        {value}
      </p>
      <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
        {sub}
      </p>
    </div>
  );
}

function Bar({ label, v }: { label: string; v: number }) {
  const pct = Math.round(clamp(v) * 100);
  const col = pct > 80 ? "#4ade80" : pct > 55 ? "var(--accent)" : "#f87171";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span style={{ color: "rgba(233,238,248,.6)" }}>{label}</span>
        <span style={{ color: "#E9EEF8" }}>{pct}</span>
      </div>
      <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,.1)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: col }} />
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
