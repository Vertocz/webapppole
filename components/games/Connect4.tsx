"use client";

import { useEffect, useState } from "react";
import RoomConnect, { RoomContext } from "./RoomConnect";
import type { NetMessage } from "@/lib/p2pRoom";

const ROWS = 6;
const COLS = 7;
type Cell = 0 | 1 | 2;
type Grid = Cell[][];

function emptyGrid(): Grid {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0) as Cell[]);
}

function checkWinner(grid: Grid): 0 | 1 | 2 {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = grid[r][c];
      if (!v) continue;
      for (const [dr, dc] of dirs) {
        let count = 1;
        for (let k = 1; k < 4; k++) {
          const nr = r + dr * k;
          const nc = c + dc * k;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || grid[nr][nc] !== v) break;
          count++;
        }
        if (count >= 4) return v as 1 | 2;
      }
    }
  }
  return 0;
}

function dropDisc(grid: Grid, col: number, player: 1 | 2): Grid | null {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (grid[r][col] === 0) {
      const next = grid.map((row) => [...row]) as Grid;
      next[r][col] = player;
      return next;
    }
  }
  return null;
}

interface GameState {
  grid: Grid;
  turn: 1 | 2;
  winner: 0 | 1 | 2;
  full: boolean;
}

function initialState(): GameState {
  return { grid: emptyGrid(), turn: 1, winner: 0, full: false };
}

function Badge({ active, name, color }: { active: boolean; name: string; color: string }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all"
      style={{
        background: active ? `${color}22` : "transparent",
        border: `1px solid ${active ? color : "var(--border)"}`,
      }}
    >
      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-sm font-medium truncate" style={{ color: active ? color : "var(--text-muted)" }}>
        {name}
      </span>
    </div>
  );
}

function GameBoard({ ctx, playerNum, solo }: { ctx: RoomContext; playerNum: 1 | 2; solo: boolean }) {
  const [state, setState] = useState<GameState>(initialState());
  const isHost = ctx.role === "host" || solo;
  const p1Name = ctx.players[0]?.name ?? "Joueur 1";
  const p2Name = ctx.players[1]?.name ?? "Joueur 2";

  // Réception des messages réseau
  useEffect(() => {
    ctx.onMessage((msg: NetMessage) => {
      if (msg.type === "state") setState(msg.payload as GameState);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // L'hôte reçoit les coups des clients et fait autorité sur l'état
  useEffect(() => {
    if (!isHost) return;
    ctx.onMessage((msg: NetMessage) => {
      if (msg.type === "move") {
        const col = (msg.payload as { col: number }).col;
        applyMoveAuthoritative(col);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost]);

  const applyMoveAuthoritative = (col: number) => {
    setState((prev) => {
      if (prev.winner || prev.full) return prev;
      const grid = dropDisc(prev.grid, col, prev.turn);
      if (!grid) return prev;
      const winner = checkWinner(grid);
      const full = grid.every((row) => row.every((c) => c !== 0));
      const next: GameState = { grid, turn: prev.turn === 1 ? 2 : 1, winner, full };
      ctx.broadcast({ type: "state", payload: next });
      return next;
    });
  };

  const handleClick = (col: number) => {
    if (state.winner || state.full) return;
    if (!solo && !isHost) {
      // Client : ne calcule rien, envoie juste le coup à l'hôte
      ctx.send({ type: "move", payload: { col }, from: ctx.myId });
      return;
    }
    if (!solo && state.turn !== playerNum) return; // pas son tour
    applyMoveAuthoritative(col);
  };

  const reset = () => {
    const next = initialState();
    setState(next);
    if (isHost) ctx.broadcast({ type: "state", payload: next });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 px-1">
        <Badge active={state.turn === 1 && !state.winner && !state.full} name={p1Name} color="#E8192C" />
        <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
          VS
        </span>
        <Badge active={state.turn === 2 && !state.winner && !state.full} name={p2Name} color="#FBBF24" />
      </div>

      <div className="rounded-2xl p-3 mx-auto" style={{ background: "var(--primary)", maxWidth: 380 }}>
        <div className="grid grid-cols-7 gap-1.5">
          {state.grid.map((row, r) =>
            row.map((cell, c) => (
              <button
                key={`${r}-${c}`}
                onClick={() => handleClick(c)}
                disabled={!!state.winner || state.full}
                className="aspect-square rounded-full transition-all active:scale-90"
                style={{
                  background: cell === 1 ? "#E8192C" : cell === 2 ? "#FBBF24" : "var(--bg-base)",
                  boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)",
                }}
              />
            ))
          )}
        </div>
      </div>

      {(state.winner || state.full) && (
        <div className="text-center space-y-3 animate-fade-in-up">
          <p className="font-display text-2xl" style={{ color: "var(--accent)" }}>
            {state.winner ? `${state.winner === 1 ? p1Name : p2Name} GAGNE !` : "MATCH NUL"}
          </p>
          <button
            onClick={reset}
            className="px-6 py-3 rounded-xl font-display tracking-widest text-sm"
            style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
          >
            REJOUER
          </button>
        </div>
      )}

      {!solo && (
        <p className="text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
          {ctx.role === "host" ? "Tu es le joueur rouge" : "Tu es le joueur jaune"}
        </p>
      )}
    </div>
  );
}

export default function Connect4() {
  return (
    <RoomConnect gameName="Puissance 4" minPlayers={1}>
      {(ctx) => {
        const solo = ctx.role === "solo";
        const playerNum: 1 | 2 = ctx.role === "host" || solo ? 1 : 2;
        return <GameBoard ctx={ctx} playerNum={playerNum} solo={solo} />;
      }}
    </RoomConnect>
  );
}
