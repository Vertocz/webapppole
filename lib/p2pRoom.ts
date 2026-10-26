"use client";

import LZString from "lz-string";

/**
 * p2pRoom.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Connexion multijoueur en local, SANS internet ni serveur.
 *
 * Principe :
 *  - Tous les téléphones sont sur le même hotspot (partage de connexion d'un
 *    des joueurs). Il n'y a donc pas besoin de serveur STUN/TURN : les
 *    candidats ICE locaux suffisent.
 *  - L'échange initial WebRTC (offer/answer), qui nécessite normalement un
 *    serveur de signaling, se fait ici à la main via des QR codes :
 *      1. L'hôte génère une "offer" et l'affiche en QR.
 *      2. Le joueur qui rejoint scanne ce QR, génère une "answer" et
 *         l'affiche à son tour en QR.
 *      3. L'hôte scanne cette réponse pour finaliser la connexion.
 *  - Topologie en étoile : chaque joueur ne se connecte qu'à l'hôte, qui fait
 *    office d'arbitre (état de jeu autoritaire) et relaie les messages.
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

// Pas de STUN/TURN : réseau local uniquement (hotspot avion)
const RTC_CONFIG: RTCConfiguration = { iceServers: [] };

// Les offres/réponses WebRTC (SDP) sont très répétitives (candidats, lignes
// de codec...) et compressent donc très bien — ça réduit nettement la
// densité du QR code affiché, ce qui compte beaucoup pour la fiabilité du
// scan à la caméra d'un téléphone (un QR trop chargé devient illisible en
// pratique bien avant d'atteindre sa limite théorique de capacité).
function encodePayload(obj: unknown): string {
  const json = JSON.stringify(obj);
  return LZString.compressToBase64(json);
}

function decodePayload<T = unknown>(str: string): T {
  const json = LZString.decompressFromBase64(str);
  if (!json) throw new Error("Payload QR invalide ou corrompu");
  return JSON.parse(json) as T;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Attend la fin de la collecte des candidats ICE pour pouvoir encoder
 * l'offre/réponse complète en un seul QR (pas de trickle ICE possible
 * sans canal de signaling continu).
 */
function waitIceComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    function check() {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    }
    pc.addEventListener("icegatheringstatechange", check);
    // Filet de sécurité : un hotspot capricieux ne doit pas bloquer le jeu
    setTimeout(resolve, 4000);
  });
}

type MessageHandler = (msg: NetMessage, fromPeerId: string) => void;

// ─── Hôte : gère plusieurs connexions clients en étoile ───────────────────────
export class HostRoom {
  peers = new Map<string, { pc: RTCPeerConnection; dc: RTCDataChannel; name: string }>();
  players: PlayerInfo[] = [{ id: "host", name: "Hôte" }];
  private handlers: MessageHandler[] = [];
  private playersHandlers: ((players: PlayerInfo[]) => void)[] = [];

  onMessage(cb: MessageHandler) {
    this.handlers.push(cb);
  }

  /** Appelé à chaque arrivée / départ d'un joueur (la liste affichée doit suivre la connexion réelle). */
  onPlayersChange(cb: (players: PlayerInfo[]) => void) {
    this.playersHandlers.push(cb);
  }

  private emitPlayers() {
    const snapshot = this.players.map((p) => ({ ...p }));
    this.playersHandlers.forEach((h) => h(snapshot));
  }

  private emit(msg: NetMessage, from: string) {
    this.handlers.forEach((h) => h(msg, from));
  }

  broadcast(msg: NetMessage, exceptPeerId?: string) {
    const data = JSON.stringify(msg);
    for (const [id, p] of this.peers) {
      if (id === exceptPeerId) continue;
      if (p.dc.readyState !== "open") continue;
      try {
        p.dc.send(data);
      } catch (err) {
        // Message trop gros ou file d'envoi pleine : on ne casse pas le jeu pour un joueur.
        console.warn("p2pRoom: envoi impossible vers", id, err);
      }
    }
  }

  /** Démarre l'invitation d'un nouveau joueur : renvoie le payload à afficher en QR */
  async createInvite(guestNameHint: string): Promise<{ peerId: string; qrPayload: string }> {
    const peerId = newId();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const dc = pc.createDataChannel("game");
    this.setupDataChannel(peerId, dc, guestNameHint);
    this.peers.set(peerId, { pc, dc, name: guestNameHint });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);

    const qrPayload = encodePayload({ kind: "offer", peerId, sdp: pc.localDescription });
    return { peerId, qrPayload };
  }

  /** Termine l'invitation une fois la réponse (QR scanné) du joueur reçue */
  async completeInvite(peerId: string, answerQrPayload: string) {
    const decoded = decodePayload<{ kind: string; sdp: RTCSessionDescriptionInit; name: string }>(
      answerQrPayload
    );
    const entry = this.peers.get(peerId);
    if (!entry) throw new Error("Invitation inconnue ou expirée");
    if (decoded.name) entry.name = decoded.name;
    await entry.pc.setRemoteDescription(decoded.sdp);
  }

  private setupDataChannel(peerId: string, dc: RTCDataChannel, name: string) {
    dc.onopen = () => {
      // Le prénom saisi par l'invité arrive dans le QR de réponse (completeInvite) : il est
      // dans `peers`, alors que `name` n'est que le prénom provisoire « Joueur N ».
      const realName = this.peers.get(peerId)?.name ?? name;
      if (!this.players.find((p) => p.id === peerId)) {
        this.players.push({ id: peerId, name: realName });
      }
      try {
        dc.send(JSON.stringify({ type: "welcome", you: peerId, players: this.players }));
      } catch (err) {
        console.warn("p2pRoom: welcome impossible", err);
      }
      this.broadcast({ type: "players", players: this.players }, peerId);
      this.emitPlayers();
    };
    dc.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as NetMessage;
        this.emit(msg, peerId);
      } catch {
        /* message non JSON ignoré */
      }
    };
    dc.onclose = () => {
      this.players = this.players.filter((p) => p.id !== peerId);
      this.peers.delete(peerId);
      this.broadcast({ type: "players", players: this.players });
      this.emitPlayers();
    };
  }
}

// ─── Client : une seule connexion vers l'hôte ─────────────────────────────────
export class ClientRoom {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null = null;
  private handlers: ((msg: NetMessage) => void)[] = [];

  constructor() {
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc.ondatachannel = (ev) => this.bindChannel(ev.channel);
  }

  onMessage(cb: (msg: NetMessage) => void) {
    this.handlers.push(cb);
  }

  send(msg: NetMessage) {
    if (this.dc?.readyState !== "open") return;
    try {
      this.dc.send(JSON.stringify(msg));
    } catch (err) {
      console.warn("p2pRoom: envoi impossible", err);
    }
  }

  private bindChannel(dc: RTCDataChannel) {
    this.dc = dc;
    dc.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as NetMessage;
        this.handlers.forEach((h) => h(msg));
      } catch {
        /* message non JSON ignoré */
      }
    };
  }

  /** À partir du QR de l'hôte (offer), génère la réponse (answer) à réafficher en QR */
  async joinFromOffer(offerQrPayload: string, myName: string): Promise<string> {
    const decoded = decodePayload<{ kind: string; peerId: string; sdp: RTCSessionDescriptionInit }>(
      offerQrPayload
    );
    await this.pc.setRemoteDescription(decoded.sdp);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitIceComplete(this.pc);
    return encodePayload({ kind: "answer", sdp: this.pc.localDescription, name: myName });
  }
}
