"use client";

import { useEffect, useRef } from "react";
import { REST_READY, REST_WAIT, buildTrajectory, drawScene, type SceneEvent, type Traj } from "@/lib/lancerFranc/scene";
import type { Outcome, ShotResult } from "@/lib/lancerFranc/shot";

/**
 * Canvas plein cadre. Une boucle d'animation tourne en continu :
 *  - sans tir, le ballon est tenu en main en bas de l'écran ; il remonte quand on peut tirer ;
 *  - chaque nouveau tir (nouvel id) relance la lecture de sa trajectoire.
 */
export function ShotScene({
  shot,
  ready,
  celebrate,
  onResult,
  onDone,
  onEvent,
}: {
  shot: ShotResult | null;
  ready?: boolean;
  celebrate?: boolean;
  onResult: (outcome: Outcome) => void;
  onDone: () => void;
  onEvent?: (e: SceneEvent) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const props = useRef({ shot, ready, celebrate, onResult, onDone, onEvent });
  props.current = { shot, ready, celebrate, onResult, onDone, onEvent };

  useEffect(() => {
    let raf = 0;
    let traj: Traj | null = null;
    let shotStart = 0;
    let lastT = -1;
    let resultSent = false;
    let doneSent = false;
    let currentId: number | null = null;
    let rest = REST_WAIT;
    let lastNow = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dtFrame = Math.min(0.1, (now - lastNow) / 1000);
      lastNow = now;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const cw = Math.round(rect.width * dpr);
      const ch = Math.round(rect.height * dpr);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const { shot: s, ready: rdy = false, celebrate: cel = false } = props.current;
      if (!s) {
        if (currentId !== null) rest = 0; // après un tir, le nouveau ballon arrive par le bas
        traj = null;
        currentId = null;
        const target = rdy ? REST_READY : REST_WAIT;
        rest += (target - rest) * (1 - Math.exp(-dtFrame * 9));
        drawScene(ctx, rect.width, rect.height, dpr, null, null, 0, rest);
        return;
      }
      if (s.id !== currentId) {
        currentId = s.id;
        shotStart = now;
        lastT = -1;
        resultSent = false;
        doneSent = false;
        traj = null;
      }
      if (!traj || traj.W !== rect.width || traj.H !== rect.height) {
        traj = buildTrajectory(s, rect.width, rect.height, cel);
      }
      const t = Math.min((now - shotStart) / 1000, traj.duration);

      for (const e of traj.events) if (e.t > lastT && e.t <= t) props.current.onEvent?.(e);
      lastT = t;
      if (!resultSent && t >= traj.tResult) {
        resultSent = true;
        props.current.onResult(s.outcome);
      }
      if (!doneSent && t >= traj.duration) {
        doneSent = true;
        props.current.onDone();
      }
      drawScene(ctx, rect.width, rect.height, dpr, s, traj, t, REST_READY);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Panier de basket et animation du lancer"
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
