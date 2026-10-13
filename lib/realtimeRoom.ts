"use client";

/**
 * realtimeRoom.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Transport alternatif à p2pRoom.ts : au lieu d'une connexion directe entre
 * téléphones (WebRTC + QR code, qui marche sans internet), on passe par un
 * canal Supabase Realtime partagé — utile quand tout le monde a du réseau et
 * qu'on veut éviter la manip du hotspot/QR code (ex : pas tous dans le même
 * avion, ou juste plus simple).
 *
 * Exactement la même interface de messages (NetMessage) que p2pRoom.ts, pour
 * que les jeux n'aient rien à savoir du transport utilisé.
 */

import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import type { NetMessage, PlayerInfo } from "./p2pRoom";

// Même projet Supabase que le reste de l'app (lib/supabase.ts)
const SUPABASE_URL = "https://fxvotvtapcwzvjhfreqv.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4dm90dnRhcGN3enZqaGZyZXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5ODU0MzMsImV4cCI6MjA3NzU2MTQzM30.-GHrLdGYicmtN2lx8MYkQlrnWKcxrcARp_tY6Cno3RQ";

const realtimeClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Code court à partager entre joueurs (plus simple à dicter qu'un QR à distance) */
export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans caractères ambigus (0/O, 1/I...)
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export class RealtimeRoom {
  myId: string;
  players: PlayerInfo[] = [];
  private channel: RealtimeChannel;
  private handlers: ((msg: NetMessage, fromId: string) => void)[] = [];
  private onPlayersChange?: (players: PlayerInfo[]) => void;

  constructor(
    private code: string,
    private myName: string
  ) {
    this.myId = newId();
    this.channel = realtimeClient.channel(`jeux-room-${code}`, {
      config: {
        broadcast: { self: false },
        presence: { key: this.myId },
      },
    });
  }

  onMessage(cb: (msg: NetMessage, fromId: string) => void) {
    this.handlers.push(cb);
  }

  send(msg: NetMessage) {
    this.channel.send({ type: "broadcast", event: "msg", payload: { msg } });
  }

  /** Alias pour coller à l'API de HostRoom (tout le monde diffuse pareil ici) */
  broadcast(msg: NetMessage) {
    this.send(msg);
  }

  async join(onPlayers: (players: PlayerInfo[]) => void): Promise<void> {
    this.onPlayersChange = onPlayers;

    this.channel.on("broadcast", { event: "msg" }, (payload) => {
      const msg = (payload.payload as { msg: NetMessage }).msg;
      // L'émetteur exact n'est pas transmis par le broadcast Realtime lui-même ;
      // les jeux n'en ont de toute façon besoin que côté hôte pour savoir qui a
      // joué, ce qu'on documente dans le message lui-même (champ "from" déjà
      // présent sur les NetMessage de type "move").
      const from = (msg as { from?: string }).from ?? "inconnu";
      this.handlers.forEach((h) => h(msg, from));
    });

    this.channel.on("presence", { event: "sync" }, () => {
      const state = this.channel.presenceState<{ name: string }>();
      const players: PlayerInfo[] = Object.entries(state).map(([id, metas]) => ({
        id,
        name: metas[0]?.name ?? "Joueur",
      }));
      this.players = players;
      this.onPlayersChange?.(players);
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Connexion au salon expirée")), 15000);
      this.channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          await this.channel.track({ name: this.myName });
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(new Error("Impossible de rejoindre le salon"));
        }
      });
    });
  }

  leave() {
    this.channel.unsubscribe();
  }
}
