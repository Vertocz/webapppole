"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NetMessage, PlayerInfo } from "@/lib/netTypes";
import { RealtimeRoom, generateRoomCode } from "@/lib/realtimeRoom";
import { getIdentity } from "@/lib/lancerFrancStats";

export interface RoomContext {
  role: "host" | "client" | "solo";
  myId: string;
  players: PlayerInfo[];
  send: (msg: NetMessage) => void;
  broadcast: (msg: NetMessage) => void;
  /** Abonne un écouteur ; la fonction renvoyée le désabonne (à appeler au démontage). */
  onMessage: (cb: (msg: NetMessage, fromPeerId?: string) => void) => () => void;
}

type Step = "choice" | "name" | "lobby";

/**
 * Salon de jeu par internet (Supabase Realtime) : l'hôte crée une partie et donne
 * un code à 5 caractères, les autres le saisissent.
 */
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
  const [mode, setMode] = useState<"host" | "client" | "solo" | null>(null);
  const [name, setName] = useState("");
  // Prénom du compte connecté : on ne le redemande pas.
  const [knownName, setKnownName] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [ready, setReady] = useState(false);
  const [myId, setMyId] = useState("solo");
  const [error, setError] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [lobbyPlayers, setLobbyPlayers] = useState<PlayerInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const realtimeRef = useRef<RealtimeRoom | null>(null);
  const readyRef = useRef(false);
  const messageHandlers = useRef<((msg: NetMessage, from?: string) => void)[]>([]);

  useEffect(() => {
    const who = getIdentity();
    if (who.id !== "local" && who.label) {
      setKnownName(who.label);
      setName(who.label);
    }
  }, []);

  // Quitte proprement le salon quand le composant est démonté
  useEffect(() => {
    return () => {
      realtimeRef.current?.leave();
    };
  }, []);

  const registerHandler = useCallback((cb: (msg: NetMessage, from?: string) => void) => {
    messageHandlers.current.push(cb);
    return () => {
      messageHandlers.current = messageHandlers.current.filter((h) => h !== cb);
    };
  }, []);

  const connect = async (code: string, asHost: boolean) => {
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
      setStep("lobby");
    } catch {
      setError("Connexion impossible. Vérifie ta connexion internet et le code.");
    } finally {
      setBusy(false);
    }
  };

  const startHost = () => {
    setMode("host");
    const code = generateRoomCode();
    setRoomCode(code);
    if (knownName) void connect(code, true);
    else setStep("name");
  };

  const startClient = () => {
    setMode("client");
    setStep("name");
  };

  const soloMode = () => {
    setMode("solo");
    setMyId("solo");
    setPlayers([{ id: "solo", name: "Moi" }]);
    setReady(true);
  };

  const launch = () => {
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

  const send = useCallback((msg: NetMessage) => {
    realtimeRef.current?.send(msg);
  }, []);

  if (ready) {
    return (
      <>
        {children({
          role: mode === "host" ? "host" : mode === "client" ? "client" : "solo",
          myId,
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
          <button
            onClick={startHost}
            disabled={busy}
            className="w-full py-3 rounded-xl font-medium text-sm disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
          >
            {busy ? "Connexion…" : "🌐 Créer une partie"}
          </button>
          <button
            onClick={startClient}
            disabled={busy}
            className="w-full py-3 rounded-xl font-medium text-sm disabled:opacity-50"
            style={{ border: "1px solid var(--border)", color: "var(--text-main)" }}
          >
            🔗 Rejoindre avec un code
          </button>
          {allowSolo && (
            <button
              onClick={soloMode}
              className="w-full py-2.5 rounded-xl font-medium text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              🧍 Jouer seul / entraînement
            </button>
          )}
          <p className="text-[11px] text-center pt-1" style={{ color: "var(--text-muted)" }}>
            Connexion internet nécessaire. L&apos;hôte donne un code à 5 caractères aux autres joueurs.
          </p>
        </div>
      )}

      {step === "name" && (
        <div className="space-y-3">
          {knownName ? (
            <p className="text-sm text-center" style={{ color: "var(--text-muted)" }}>
              Tu joues en tant que <span style={{ color: "var(--text-main)", fontWeight: 600 }}>{knownName}</span>
            </p>
          ) : (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ton prénom"
              className="w-full px-4 py-3 rounded-xl outline-none text-sm"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)" }}
            />
          )}
          {mode === "client" && (
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="CODE"
              maxLength={5}
              autoFocus
              className="w-full px-4 py-3 rounded-xl outline-none text-lg text-center font-mono tracking-[0.4em]"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)" }}
            />
          )}
          <button
            onClick={() => (mode === "host" ? connect(roomCode, true) : connect(joinCode, false))}
            disabled={!name.trim() || busy || (mode === "client" && joinCode.length < 5)}
            className="w-full py-3 rounded-xl font-medium text-sm disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
          >
            {busy ? "Connexion…" : "Continuer"}
          </button>
          <button
            onClick={() => {
              setStep("choice");
              setError("");
            }}
            className="w-full py-2 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            Retour
          </button>
        </div>
      )}

      {step === "lobby" && (
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
              onClick={launch}
              disabled={lobbyPlayers.length < minPlayers}
              className="w-full py-3.5 rounded-xl font-display tracking-widest text-sm disabled:opacity-40"
              style={{ background: "linear-gradient(135deg,var(--primary),var(--primary-light))", color: "white" }}
            >
              LANCER LA PARTIE
            </button>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {lobbyPlayers.length <= 1 ? "Personne d'autre dans le salon : vérifie le code. " : ""}
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
