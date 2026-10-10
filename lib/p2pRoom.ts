"use client";

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

// ─── Encodage compact pour QR ─────────────────────────────────────────────────
// Plus le payload est court, moins le QR a de modules => scan bien plus fiable.
// Format : "1" + base64url(deflate-raw(json)) ou "0" + base64url(json) en repli.

function toB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipeThrough(
  data: Uint8Array,
  stream: CompressionStream | DecompressionStream
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  writer.write(data as unknown as BufferSource);
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** Retire de la SDP ce qui est inutile en réseau local (TCP, IPv6) */
function slimSdp(desc: RTCSessionDescriptionInit | null): RTCSessionDescriptionInit {
  if (!desc?.sdp) throw new Error("SDP manquante");
  const lines = desc.sdp.split(/\r?\n/).filter((l) => {
    if (!l.startsWith("a=candidate")) return true;
    if (/ tcp /i.test(l)) return false; // candidats TCP
    if (/ [0-9a-f]*:[0-9a-f:]+ \d+ typ/i.test(l)) return false; // IPv6
    return true;
  });
  return { type: desc.type, sdp: lines.join("\r\n") };
}

async function encodePayload(obj: unknown): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream !== "undefined") {
    try {
      const packed = await pipeThrough(raw, new CompressionStream("deflate-raw"));
      return "1" + toB64Url(packed);
    } catch {
      /* repli non compressé */
    }
  }
  return "0" + toB64Url(raw);
}

async function decodePayload<T = unknown>(str: string): Promise<T> {
  const mode = str[0];
  const bytes = fromB64Url(str.slice(1));
  let raw = bytes;
  if (mode === "1") {
    raw = await pipeThrough(bytes, new DecompressionStream("deflate-raw"));
  } else if (mode !== "0") {
    throw new Error("Format de QR inconnu");
  }
  return JSON.parse(new TextDecoder().decode(raw)) as T;
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

export interface CandidateInfo {
  total: number;
  /** adresses masquées par le navigateur (xxxx.local) : le plus souvent la cause d'un échec sur hotspot */
  hidden: number;
  /** vraies adresses IP locales */
  real: number;
}

/** Compte les candidats réseau d'une SDP, pour diagnostiquer une connexion qui n'aboutit pas. */
export function summarizeCandidates(sdp?: string | null): CandidateInfo {
  const info: CandidateInfo = { total: 0, hidden: 0, real: 0 };
  for (const l of (sdp ?? "").split(/\r?\n/)) {
    if (!l.startsWith("a=candidate")) continue;
    info.total++;
    const addr = l.split(" ")[4] ?? "";
    if (addr.endsWith(".local")) info.hidden++;
    else info.real++;
  }
  return info;
}

/**
 * Chrome et Safari masquent l'IP locale (xxxx.local) tant que la page n'a pas
 * accès à la caméra. Sur un hotspot, cette résolution échoue souvent : la
 * connexion n'aboutit jamais. On ouvre donc brièvement la caméra pendant la
 * collecte des candidats pour exposer les vraies adresses. Refus = on continue.
 */
async function unlockLocalIps(): Promise<() => void> {
  try {
    if (!navigator.mediaDevices?.getUserMedia) return () => {};
    const st = await navigator.mediaDevices.getUserMedia({ video: true });
    return () => st.getTracks().forEach((t) => t.stop());
  } catch {
    return () => {};
  }
}

export type PeerStatus = "connecting" | "connected" | "failed";
const CONNECT_TIMEOUT_MS = 25000;

type MessageHandler = (msg: NetMessage, fromPeerId: string) => void;

// ─── Hôte : gère plusieurs connexions clients en étoile ───────────────────────
export class HostRoom {
  peers = new Map<string, { pc: RTCPeerConnection; dc: RTCDataChannel; name: string }>();
  players: PlayerInfo[] = [{ id: "host", name: "Hôte" }];
  /** invités dont la réponse a été scannée mais qui ne sont pas (encore) connectés */
  status = new Map<string, PeerStatus>();
  private handlers: MessageHandler[] = [];
  private listeners = new Set<() => void>();

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify() {
    this.listeners.forEach((f) => f());
  }

  /** Invités en cours de connexion ou en échec (hors joueurs déjà connectés) */
  guests(): { peerId: string; name: string; status: PeerStatus }[] {
    const out: { peerId: string; name: string; status: PeerStatus }[] = [];
    for (const [id, st] of this.status) {
      if (st === "connected") continue;
      out.push({ peerId: id, name: this.peers.get(id)?.name ?? "Joueur", status: st });
    }
    return out;
  }

  dismiss(peerId: string) {
    this.peers.get(peerId)?.pc.close();
    this.peers.delete(peerId);
    this.status.delete(peerId);
    this.notify();
  }

  onMessage(cb: MessageHandler) {
    this.handlers.push(cb);
  }

  private emit(msg: NetMessage, from: string) {
    this.handlers.forEach((h) => h(msg, from));
  }

  broadcast(msg: NetMessage, exceptPeerId?: string) {
    const data = JSON.stringify(msg);
    for (const [id, p] of this.peers) {
      if (id === exceptPeerId) continue;
      if (p.dc.readyState === "open") p.dc.send(data);
    }
  }

  /** Démarre l'invitation d'un nouveau joueur : renvoie le payload à afficher en QR */
  async createInvite(
    guestNameHint: string
  ): Promise<{ peerId: string; qrPayload: string; info: CandidateInfo }> {
    const peerId = newId();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const dc = pc.createDataChannel("game");
    this.setupDataChannel(peerId, dc);
    this.peers.set(peerId, { pc, dc, name: guestNameHint });

    const onState = () => {
      if (pc.connectionState === "failed" || pc.iceConnectionState === "failed") {
        if (this.status.get(peerId) === "connecting") {
          this.status.set(peerId, "failed");
          this.notify();
        }
      }
    };
    pc.addEventListener("connectionstatechange", onState);
    pc.addEventListener("iceconnectionstatechange", onState);

    const release = await unlockLocalIps();
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceComplete(pc);
    } finally {
      release();
    }

    const qrPayload = await encodePayload({
      kind: "offer",
      peerId,
      sdp: slimSdp(pc.localDescription),
    });
    return { peerId, qrPayload, info: summarizeCandidates(pc.localDescription?.sdp) };
  }

  /** Termine l'invitation une fois la réponse (QR scanné) du joueur reçue */
  async completeInvite(peerId: string, answerQrPayload: string) {
    const decoded = await decodePayload<{ kind: string; sdp: RTCSessionDescriptionInit; name: string }>(
      answerQrPayload
    );
    const entry = this.peers.get(peerId);
    if (!entry) throw new Error("Invitation inconnue ou expirée");
    if (decoded.name) entry.name = decoded.name;
    this.status.set(peerId, "connecting");
    this.notify();
    await entry.pc.setRemoteDescription(decoded.sdp);
    // Pas de connexion au bout d'un moment : on le dit au lieu de rester muet
    setTimeout(() => {
      if (this.status.get(peerId) === "connecting") {
        this.status.set(peerId, "failed");
        this.notify();
      }
    }, CONNECT_TIMEOUT_MS);
  }

  private setupDataChannel(peerId: string, dc: RTCDataChannel) {
    dc.onopen = () => {
      // le nom réel du joueur arrive avec sa réponse (completeInvite), pas à la création
      const name = this.peers.get(peerId)?.name ?? "Joueur";
      if (!this.players.find((p) => p.id === peerId)) {
        this.players.push({ id: peerId, name });
      }
      this.status.set(peerId, "connected");
      dc.send(JSON.stringify({ type: "welcome", you: peerId, players: this.players }));
      this.broadcast({ type: "players", players: this.players }, peerId);
      this.notify();
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
      this.status.delete(peerId);
      this.broadcast({ type: "players", players: this.players });
      this.notify();
    };
  }
}

// ─── Client : une seule connexion vers l'hôte ─────────────────────────────────
export class ClientRoom {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null = null;
  info: CandidateInfo = { total: 0, hidden: 0, real: 0 };
  state: "waiting" | "connecting" | "failed" = "waiting";
  private handlers: ((msg: NetMessage) => void)[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc.ondatachannel = (ev) => this.bindChannel(ev.channel);
    const onState = () => {
      const next =
        this.pc.connectionState === "failed" || this.pc.iceConnectionState === "failed"
          ? "failed"
          : this.pc.iceConnectionState === "checking" || this.pc.iceConnectionState === "connected"
          ? "connecting"
          : "waiting";
      if (next !== this.state) {
        this.state = next;
        this.listeners.forEach((f) => f());
      }
    };
    this.pc.addEventListener("connectionstatechange", onState);
    this.pc.addEventListener("iceconnectionstatechange", onState);
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onMessage(cb: (msg: NetMessage) => void) {
    this.handlers.push(cb);
  }

  send(msg: NetMessage) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(msg));
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
    const decoded = await decodePayload<{ kind: string; peerId: string; sdp: RTCSessionDescriptionInit }>(
      offerQrPayload
    );
    await this.pc.setRemoteDescription(decoded.sdp);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitIceComplete(this.pc);
    this.info = summarizeCandidates(this.pc.localDescription?.sdp);
    return encodePayload({
      kind: "answer",
      sdp: slimSdp(this.pc.localDescription),
      name: myName,
    });
  }
}
