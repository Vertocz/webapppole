/**
 * Types des messages échangés pendant les jeux à plusieurs (transport : lib/realtimeRoom.ts).
 * L'hôte fait office d'arbitre : il diffuse l'état (« state »), les autres envoient leurs actions (« move »).
 */

export interface PlayerInfo {
  id: string;
  name: string;
}

export type NetMessage =
  | { type: "welcome"; you: string; players: PlayerInfo[] }
  | { type: "players"; players: PlayerInfo[] }
  | { type: "move"; payload: unknown; from: string }
  | { type: "state"; payload: unknown };
