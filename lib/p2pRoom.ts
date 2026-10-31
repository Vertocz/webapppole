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

// ─── Format compact des QR codes ─────────────────────────────────────────────
// Un SDP complet fait ~600 caractères : QR version 19 (93×93 modules), trop dense pour
// la caméra d'un téléphone. On n'envoie que ce qui varie (identifiants ICE, empreinte,
// adresses) et le reste est reconstruit à l'arrivée : ~120 caractères, QR version ~6.
// Si le SDP sort du schéma attendu (autre navigateur…), on retombe sur l'ancien format.

interface Signal {
  kind: "offer" | "answer";
  /** peerId pour une offre, prénom du joueur pour une réponse */
  extra: string;
  sdp: RTCSessionDescriptionInit;
}

const KNOWN_FIXED_LINES = [
  /^v=0$/,
  /^o=.* IN IP4 127\.0\.0\.1$/,
  /^s=-$/,
  /^t=0 0$/,
  /^a=group:BUNDLE 0$/,
  /^a=extmap-allow-mixed$/,
  /^a=msid-semantic: ?WMS ?\*?$/,
  /^m=application 9 UDP\/DTLS\/SCTP webrtc-datachannel$/,
  /^c=IN IP4 0\.0\.0\.0$/,
  /^a=ice-options:trickle$/,
  /^a=setup:(actpass|active)$/,
  /^a=mid:0$/,
  /^a=sctp-port:5000$/,
  /^a=max-message-size:262144$/,
];

function hexToB64(hex: string): string {
  const bytes = hex.split(":").map((h) => parseInt(h, 16));
  return btoa(String.fromCharCode(...bytes));
}

function b64ToHex(b64: string): string {
  return Array.from(atob(b64))
    .map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"))
    .join(":");
}

function sdpToCompact(kind: "offer" | "answer", extra: string, desc: RTCSessionDescriptionInit): string | null {
  const text = desc.sdp;
  if (!text || desc.type !== kind) return null;
  let ufrag = "";
  let pwd = "";
  let fp = "";
  const cands: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^a=ice-ufrag:(\S+)$/))) ufrag = m[1];
    else if ((m = line.match(/^a=ice-pwd:(\S+)$/))) pwd = m[1];
    else if ((m = line.match(/^a=fingerprint:sha-256 ([0-9A-Fa-f:]+)$/))) fp = hexToB64(m[1]);
    else if ((m = line.match(/^a=candidate:\S+ 1 udp (\d+) (\S+) (\d+) typ host(?: generation \d+)?(?: network-id \d+)?(?: network-cost \d+)?(?: ufrag \S+)?$/))) {
      cands.push(`${m[1]},${m[2]},${m[3]}`);
    } else if (!KNOWN_FIXED_LINES.some((re) => re.test(line))) return null;
  }
  if (!ufrag || !pwd || !fp || cands.length === 0) return null;
  if (/[|;]/.test(ufrag + pwd + fp)) return null;
  const out = `~${kind === "offer" ? "o" : "a"}|${encodeURIComponent(extra)}|${ufrag}|${pwd}|${fp}|${cands.join(";")}`;
  return out;
}

function compactToSignal(str: string): Signal {
  const [k, extra, ufrag, pwd, fp, cands] = str.slice(1).split("|");
  if (!ufrag || !pwd || !fp || !cands) throw new Error("QR compact invalide");
  const kind = k === "o" ? "offer" : "answer";
  const lines = [
    "v=0",
    "o=- 1 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=extmap-allow-mixed",
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    ...cands.split(";").map((c, i) => {
      const [prio, addr, port] = c.split(",");
      return `a=candidate:${i + 1} 1 udp ${prio} ${addr} ${port} typ host generation 0`;
    }),
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${pwd}`,
    "a=ice-options:trickle",
    `a=fingerprint:sha-256 ${b64ToHex(fp)}`,
    `a=setup:${kind === "offer" ? "actpass" : "active"}`,
    "a=mid:0",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
  ];
  return { kind, extra: decodeURIComponent(extra ?? ""), sdp: { type: kind, sdp: lines.join("\r\n") + "\r\n" } };
}

function encodeSignal(kind: "offer" | "answer", extra: string, desc: RTCSessionDescriptionInit | null): string {
  if (!desc) throw new Error("Description locale absente");
  const compact = sdpToCompact(kind, extra, desc);
  if (compact) return compact;
  return encodePayload(kind === "offer" ? { kind, peerId: extra, sdp: desc } : { kind, name: extra, sdp: desc });
}

function decodeSignal(str: string): Signal {
  if (str.startsWith("~")) return compactToSignal(str);
  const d = decodePayload<{ kind: "offer" | "answer"; peerId?: string; name?: string; sdp: RTCSessionDescriptionInit }>(str);
  return { kind: d.kind, extra: (d.kind === "offer" ? d.peerId : d.name) ?? "", sdp: d.sdp };
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

/**
 * Chrome et Safari masquent l'adresse locale des candidats ICE derrière un nom « xxxx.local »
 * (mDNS) tant que la page n'a pas la permission caméra. Entre deux téléphones sur un hotspot,
 * ce nom ne se résout pas toujours : la liaison échoue en silence. L'hôte crée son invitation
 * AVANT de scanner quoi que ce soit : on demande donc la caméra d'abord (il en a besoin de
 * toute façon pour scanner la réponse), ce qui donne de vraies adresses IP, plus courtes aussi.
 */
let mediaPrimed = false;
export async function primeMediaPermission(): Promise<void> {
  if (mediaPrimed || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
  mediaPrimed = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    /* refusée : on continue, ça marchera peut-être quand même */
  }
}

/** Résumé lisible pour le diagnostic : états ICE / canal et nature des adresses. */
export function describeLink(pc: RTCPeerConnection, dc: RTCDataChannel | null): string {
  const sdp = `${pc.localDescription?.sdp ?? ""}\n${pc.remoteDescription?.sdp ?? ""}`;
  const cands = sdp.split(/\r?\n/).filter((l) => l.startsWith("a=candidate:"));
  const mdns = cands.filter((l) => /\.local /.test(l)).length;
  return `ice ${pc.iceConnectionState} · canal ${dc?.readyState ?? "aucun"} · ${cands.length} adresse(s)${mdns ? `, dont ${mdns} masquée(s)` : ""}`;
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
    await primeMediaPermission();
    const peerId = newId();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const dc = pc.createDataChannel("game");
    this.setupDataChannel(peerId, dc, guestNameHint);
    this.peers.set(peerId, { pc, dc, name: guestNameHint });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);

    const qrPayload = encodeSignal("offer", peerId, pc.localDescription);
    return { peerId, qrPayload };
  }

  /** État de la liaison avec un invité (pour affichage). */
  linkState(peerId: string): { connected: boolean; failed: boolean; text: string } | null {
    const e = this.peers.get(peerId);
    if (!e) return null;
    const st = e.pc.iceConnectionState;
    return {
      connected: e.dc.readyState === "open",
      failed: st === "failed" || st === "closed",
      text: describeLink(e.pc, e.dc),
    };
  }

  /** Abandonne une invitation qui n'a pas abouti. */
  dropPeer(peerId: string) {
    const e = this.peers.get(peerId);
    if (!e) return;
    this.peers.delete(peerId);
    try {
      e.dc.onclose = null;
      e.dc.close();
      e.pc.close();
    } catch {
      /* déjà fermée */
    }
  }

  /** Termine l'invitation une fois la réponse (QR scanné) du joueur reçue */
  async completeInvite(peerId: string, answerQrPayload: string) {
    const decoded = decodeSignal(answerQrPayload);
    if (decoded.kind !== "answer") throw new Error("Ce QR n'est pas une réponse");
    const entry = this.peers.get(peerId);
    if (!entry) throw new Error("Invitation inconnue ou expirée");
    if (decoded.extra) entry.name = decoded.extra;
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

  /** État de la liaison avec l'hôte (pour affichage). */
  linkState(): { connected: boolean; failed: boolean; text: string } {
    const st = this.pc.iceConnectionState;
    return {
      connected: this.dc?.readyState === "open",
      failed: st === "failed" || st === "closed",
      text: describeLink(this.pc, this.dc),
    };
  }

  /** À partir du QR de l'hôte (offer), génère la réponse (answer) à réafficher en QR */
  async joinFromOffer(offerQrPayload: string, myName: string): Promise<string> {
    const decoded = decodeSignal(offerQrPayload);
    if (decoded.kind !== "offer") throw new Error("Ce QR n'est pas une invitation");
    await this.pc.setRemoteDescription(decoded.sdp);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitIceComplete(this.pc);
    return encodeSignal("answer", myName, this.pc.localDescription);
  }
}
