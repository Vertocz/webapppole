"use client";

import { useCallback, useRef, useState } from "react";
import { HostRoom, ClientRoom, NetMessage, PlayerInfo } from "@/lib/p2pRoom";
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

type Step =
  | "choice"
  | "name"
  | "host-lobby"
  | "host-scan-answer"
  | "join-scan-offer"
  | "join-waiting";

export default function RoomConnect({
  gameName,
  minPlayers = 1,
  children,
}: {
  gameName: string;
  minPlayers?: number;
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

  const send = useCallback(
    (msg: NetMessage) => {
      if (mode === "host") hostRef.current?.broadcast(msg);
      else if (mode === "client") clientRef.current?.send(msg);
    },
    [mode]
  );

  if (ready) {
    return (
      <>
        {children({
          role: mode === "host" ? "host" : mode === "client" ? "client" : "solo",
          myId: mode === "host" ? "host" : myId,
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
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Comment veux-tu jouer ?
          </p>
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
          <button
            onClick={soloMode}
            className="w-full py-2.5 rounded-xl font-medium text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            🧍 Jouer seul / entraînement
          </button>
          <p className="text-[11px] text-center pt-1" style={{ color: "var(--text-muted)" }}>
            Aucune connexion internet requise — un joueur active son partage de
            connexion, les autres se connectent à son réseau.
          </p>
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
          <button
            onClick={mode === "host" ? confirmNameHost : confirmNameClient}
            disabled={!name.trim()}
            className="w-full py-3 rounded-xl font-medium text-sm disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
          >
            Continuer
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

      {error && (
        <p className="text-xs" style={{ color: "#f87171" }}>
          {error}
        </p>
      )}
    </div>
  );
}
