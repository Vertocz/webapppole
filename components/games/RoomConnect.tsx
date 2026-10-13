"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HostRoom, ClientRoom, NetMessage, PlayerInfo } from "@/lib/p2pRoom";
import { RealtimeRoom, generateRoomCode } from "@/lib/realtimeRoom";
import QRCodeDisplay from "./QRCodeDisplay";
import QRScanner from "./QRScanner";

export interface RoomContext {
  role: "host" | "client" | "solo";
  myId: string;
  players: PlayerInfo[];
  send: (msg: NetMessage) => void;
  broadcast: (msg: NetMessage) => void;
  onMessage: (cb: (msg: NetMessage, fromPeerId?: string) => void) => void;
}

type Transport = "local" | "internet";

type Step =
  | "choice"
  | "internet-lobby"
  | "name"
  | "host-lobby"
  | "host-scan-answer"
  | "join-scan-offer"
  | "join-waiting";

export default function RoomConnect({
  gameName,
  minPlayers = 1,
  allowSolo = true,
  children,
}: {
  gameName: string;
  minPlayers?: number;
  allowSolo?: boolean;
  children: (ctx: RoomContext) => React.ReactNode;
}) {
  const [step, setStep] = useState<Step>("choice");
  const [mode, setMode] = useState<"host" | "client" | null>(null);
  const [name, setName] = useState("");
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [invitePayload, setInvitePayload] = useState<string | null>(null);
  const [pendingPeerId, setPendingPeerId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [myId, setMyId] = useState("host");
  const [error, setError] = useState("");
  const [transport, setTransport] = useState<Transport>("local");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [lobbyPlayers, setLobbyPlayers] = useState<PlayerInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const realtimeRef = useRef<RealtimeRoom | null>(null);
  const readyRef = useRef(false);

  // Quitte proprement le salon internet quand le composant est démonté
  useEffect(() => {
    return () => {
      realtimeRef.current?.leave();
    };
  }, []);

  const hostRef = useRef<HostRoom | null>(null);
  const clientRef = useRef<ClientRoom | null>(null);
  const messageHandlers = useRef<((msg: NetMessage, from?: string) => void)[]>([]);

  const registerHandler = useCallback((cb: (msg: NetMessage, from?: string) => void) => {
    messageHandlers.current.push(cb);
  }, []);

  const startHost = () => {
    hostRef.current = new HostRoom();
    hostRef.current.onMessage((msg, from) =>
      messageHandlers.current.forEach((h) => h(msg, from))
    );
    setPlayers(hostRef.current.players);
    setMode("host");
    setStep("name");
  };

  const startClient = () => {
    clientRef.current = new ClientRoom();
    setMode("client");
    setStep("name");
  };

  const soloMode = () => {
    setMode(null);
    setMyId("solo");
    setPlayers([{ id: "solo", name: "Moi" }]);
    setReady(true);
  };

  const confirmNameHost = async () => {
    if (!hostRef.current) return;
    hostRef.current.players[0].name = name || "Hôte";
    setPlayers([...hostRef.current.players]);
    await inviteNext();
  };

  const inviteNext = async () => {
    if (!hostRef.current) return;
    setError("");
    try {
      const guestHint = `Joueur ${hostRef.current.players.length + 1}`;
      const { peerId, qrPayload } = await hostRef.current.createInvite(guestHint);
      setPendingPeerId(peerId);
      setInvitePayload(qrPayload);
      setStep("host-lobby");
    } catch {
      setError("Impossible de créer l'invitation. Réessaie.");
    }
  };

  const confirmNameClient = () => setStep("join-scan-offer");

  const handleScannedOffer = async (data: string) => {
    if (!clientRef.current) return;
    setError("");
    try {
      const answerPayload = await clientRef.current.joinFromOffer(data, name || "Joueur");
      clientRef.current.onMessage((msg) => {
        if (msg.type === "welcome") {
          setMyId(msg.you);
          setPlayers(msg.players);
          setReady(true);
        }
        if (msg.type === "players") setPlayers(msg.players);
        messageHandlers.current.forEach((h) => h(msg));
      });
      setInvitePayload(answerPayload);
      setStep("join-waiting");
    } catch {
      setError("QR invalide ou expiré, réessaie.");
      setStep("join-scan-offer");
    }
  };

  const handleScannedAnswer = async (data: string) => {
    if (!hostRef.current || !pendingPeerId) return;
    setError("");
    try {
      await hostRef.current.completeInvite(pendingPeerId, data);
      setPendingPeerId(null);
      setInvitePayload(null);
      setStep("host-lobby");
      setPlayers([...hostRef.current.players]);
    } catch {
      setError("QR invalide ou expiré, réessaie.");
      setStep("host-lobby");
    }
  };

  // ── Mode internet (Supabase Realtime) ─────────────────────────────────────
  const startInternetHost = () => {
    setMode("host");
    setRoomCode(generateRoomCode());
    setStep("name");
  };

  const startInternetClient = () => {
    setMode("client");
    setStep("name");
  };

  const connectInternet = async (code: string, asHost: boolean) => {
    setError("");
    setBusy(true);
    try {
      const room = new RealtimeRoom(code, name.trim() || (asHost ? "Hôte" : "Joueur"));
      realtimeRef.current = room;
      room.onMessage((msg, from) => {
        if (!asHost && msg.type === "welcome" && !readyRef.current) {
          readyRef.current = true;
          setPlayers(msg.players);
          setReady(true);
        }
        if (!asHost && msg.type === "players") setPlayers(msg.players);
        messageHandlers.current.forEach((h) => h(msg, from));
      });
      await room.join((p) => {
        if (!readyRef.current) setLobbyPlayers(p);
      });
      setMyId(room.myId);
      setStep("internet-lobby");
    } catch {
      setError("Connexion impossible. Vérifie ta connexion internet et le code.");
    } finally {
      setBusy(false);
    }
  };

  const launchInternetGame = () => {
    const room = realtimeRef.current;
    if (!room) return;
    const me: PlayerInfo = { id: room.myId, name: name.trim() || "Hôte" };
    const others = lobbyPlayers.filter((p) => p.id !== room.myId);
    const list = [me, ...others];
    setPlayers(list);
    room.send({ type: "welcome", you: "", players: list });
    readyRef.current = true;
    setReady(true);
  };

  const send = useCallback(
    (msg: NetMessage) => {
      if (transport === "internet") {
        realtimeRef.current?.send(msg);
        return;
      }
      if (mode === "host") hostRef.current?.broadcast(msg);
      else if (mode === "client") clientRef.current?.send(msg);
    },
    [mode, transport]
  );

  if (ready) {
    return (
      <>
        {children({
          role: mode === "host" ? "host" : mode === "client" ? "client" : "solo",
          myId: transport === "local" && mode === "host" ? "host" : myId,
          players,
          send,
          broadcast: send,
          onMessage: registerHandler,
        })}
      </>
    );
  }

  return (
    <div
      className="rounded-2xl p-6 space-y-4"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
    >
      <h3 className="font-display text-xl" style={{ color: "var(--text-main)" }}>
        {gameName.toUpperCase()}
      </h3>

      {step === "choice" && (
        <div className="space-y-3">
          <div
            className="flex rounded-xl p-1 gap-1"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}
          >
            {(["local", "internet"] as Transport[]).map((t) => (
              <button
                key={t}
                onClick={() => setTransport(t)}
                className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                style={
                  transport === t
                    ? { background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }
                    : { color: "var(--text-muted)" }
                }
              >
                {t === "local" ? "📶 Sans internet (avion)" : "🌐 Avec internet"}
              </button>
            ))}
          </div>

          {transport === "local" ? (
            <>
              <button
                onClick={startHost}
                className="w-full py-3 rounded-xl font-medium text-sm"
                style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
              >
                📶 Créer une partie (hôte)
              </button>
              <button
                onClick={startClient}
                className="w-full py-3 rounded-xl font-medium text-sm"
                style={{ border: "1px solid var(--border)", color: "var(--text-main)" }}
              >
                🔗 Rejoindre une partie
              </button>
              <p className="text-[11px] text-center pt-1" style={{ color: "var(--text-muted)" }}>
                Aucune connexion internet requise — un joueur active son partage de
                connexion, les autres se connectent à son réseau puis scannent un QR code.
              </p>
            </>
          ) : (
            <>
              <button
                onClick={startInternetHost}
                className="w-full py-3 rounded-xl font-medium text-sm"
                style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
              >
                🌐 Créer une partie
              </button>
              <button
                onClick={startInternetClient}
                className="w-full py-3 rounded-xl font-medium text-sm"
                style={{ border: "1px solid var(--border)", color: "var(--text-main)" }}
              >
                🔗 Rejoindre avec un code
              </button>
              <p className="text-[11px] text-center pt-1" style={{ color: "var(--text-muted)" }}>
                Tout le monde doit avoir une connexion internet. Pas de QR code :
                l&apos;hôte donne un code à 5 caractères.
              </p>
            </>
          )}

          {allowSolo && (
            <button
              onClick={soloMode}
              className="w-full py-2.5 rounded-xl font-medium text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              🧍 Jouer seul / entraînement
            </button>
          )}
        </div>
      )}

      {step === "name" && (
        <div className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ton prénom"
            className="w-full px-4 py-3 rounded-xl outline-none text-sm"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)" }}
          />
          {transport === "internet" && mode === "client" && (
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="CODE"
              maxLength={5}
              className="w-full px-4 py-3 rounded-xl outline-none text-lg text-center font-mono tracking-[0.4em]"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)" }}
            />
          )}
          <button
            onClick={() => {
              if (transport === "internet") {
                if (mode === "host") connectInternet(roomCode, true);
                else connectInternet(joinCode, false);
              } else if (mode === "host") confirmNameHost();
              else confirmNameClient();
            }}
            disabled={
              !name.trim() ||
              busy ||
              (transport === "internet" && mode === "client" && joinCode.length < 5)
            }
            className="w-full py-3 rounded-xl font-medium text-sm disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
          >
            {busy ? "Connexion…" : "Continuer"}
          </button>
        </div>
      )}

      {step === "host-lobby" && (
        <div className="space-y-4">
          {invitePayload && (
            <div className="text-center space-y-3">
              <p className="text-sm" style={{ color: "var(--text-sub)" }}>
                Fais scanner ce QR au joueur suivant :
              </p>
              <div className="flex justify-center">
                <QRCodeDisplay data={invitePayload} />
              </div>
              <button
                onClick={() => setStep("host-scan-answer")}
                className="w-full py-3 rounded-xl font-medium text-sm"
                style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
              >
                📷 Scanner sa réponse
              </button>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-xs uppercase tracking-widest" style={{ color: "var(--text-sub)" }}>
              Joueurs connectés ({players.length})
            </p>
            {players.map((p) => (
              <div
                key={p.id}
                className="px-3 py-2 rounded-lg text-sm"
                style={{ background: "var(--bg-input)", color: "var(--text-main)" }}
              >
                {p.name}
              </div>
            ))}
          </div>

          {!invitePayload && (
            <button
              onClick={inviteNext}
              className="w-full py-2.5 rounded-xl text-sm font-medium"
              style={{ border: "1px solid var(--border)", color: "var(--text-main)" }}
            >
              ➕ Ajouter un joueur
            </button>
          )}

          <button
            onClick={() => setReady(true)}
            disabled={players.length < minPlayers}
            className="w-full py-3.5 rounded-xl font-display tracking-widest text-sm disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,var(--primary),var(--primary-light))", color: "white" }}
          >
            LANCER LA PARTIE
          </button>
        </div>
      )}

      {step === "host-scan-answer" && (
        <QRScanner onScan={handleScannedAnswer} onCancel={() => setStep("host-lobby")} />
      )}

      {step === "join-scan-offer" && (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: "var(--text-sub)" }}>
            Scanne le QR affiché par l&apos;hôte :
          </p>
          <QRScanner onScan={handleScannedOffer} onCancel={() => setStep("choice")} />
        </div>
      )}

      {step === "join-waiting" && invitePayload && (
        <div className="text-center space-y-3">
          <p className="text-sm" style={{ color: "var(--text-sub)" }}>
            Montre ce QR à l&apos;hôte pour finaliser la connexion :
          </p>
          <div className="flex justify-center">
            <QRCodeDisplay data={invitePayload} />
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            En attente de connexion…
          </p>
        </div>
      )}

      {step === "internet-lobby" && (
        <div className="space-y-4 text-center">
          {mode === "host" ? (
            <>
              <p className="text-sm" style={{ color: "var(--text-sub)" }}>
                Donne ce code aux autres joueurs :
              </p>
              <p className="font-display text-5xl tracking-[0.3em]" style={{ color: "var(--accent)" }}>
                {roomCode}
              </p>
            </>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-sub)" }}>
              Connecté au salon <strong style={{ color: "var(--accent)" }}>{joinCode}</strong>
            </p>
          )}

          <div className="space-y-1.5 text-left">
            <p className="text-xs uppercase tracking-widest" style={{ color: "var(--text-sub)" }}>
              Joueurs présents ({lobbyPlayers.length})
            </p>
            {lobbyPlayers.map((p) => (
              <div
                key={p.id}
                className="px-3 py-2 rounded-lg text-sm"
                style={{ background: "var(--bg-input)", color: "var(--text-main)" }}
              >
                {p.name}
              </div>
            ))}
          </div>

          {mode === "host" ? (
            <button
              onClick={launchInternetGame}
              disabled={lobbyPlayers.length < minPlayers}
              className="w-full py-3.5 rounded-xl font-display tracking-widest text-sm disabled:opacity-40"
              style={{ background: "linear-gradient(135deg,var(--primary),var(--primary-light))", color: "white" }}
            >
              LANCER LA PARTIE
            </button>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {lobbyPlayers.length <= 1
                ? "Personne d'autre dans le salon : vérifie le code. "
                : ""}
              En attente que l&apos;hôte lance la partie…
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs" style={{ color: "#f87171" }}>
          {error}
        </p>
      )}
    </div>
  );
}
