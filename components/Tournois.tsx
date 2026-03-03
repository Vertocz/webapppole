"use client";

const FIBA_URL = "https://play.fiba3x3.com/events?lang=fr-FR";

export default function Tournois() {
  return (
    <div className="space-y-5">
      {/* Hero card */}
      <div className="relative rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #0B1629 0%, #0E1E38 60%, #111528 100%)",
          border: "1px solid rgba(232,25,44,0.2)",
        }}>
        {/* Décoration fond */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute" style={{ top: "-30%", right: "-10%", width: "50%", height: "180%", borderRadius: "50%", background: "radial-gradient(circle, rgba(232,25,44,0.06) 0%, transparent 70%)" }} />
          <div className="absolute" style={{ bottom: "-20%", left: "-5%", width: "40%", height: "120%", borderRadius: "50%", background: "radial-gradient(circle, rgba(27,58,140,0.08) 0%, transparent 70%)" }} />
          {/* Lignes terrain */}
          <div className="absolute" style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "200px", height: "200px", borderRadius: "50%", border: "1px solid rgba(255,255,255,0.03)" }} />
          <div className="absolute" style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "140px", height: "140px", borderRadius: "50%", border: "1px solid rgba(255,255,255,0.02)" }} />
        </div>

        <div className="relative z-10 p-6">
          {/* Badge FIBA */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5"
            style={{ background: "rgba(232,25,44,0.12)", border: "1px solid rgba(232,25,44,0.25)" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#E8192C" }} />
            <span className="text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color: "#E8192C" }}>
              FIBA 3x3 Play
            </span>
          </div>

          <h2 className="font-display text-3xl leading-tight mb-2" style={{ color: "#E8EEF8" }}>
            TROUVE TON PROCHAIN TOURNOI
          </h2>
          <p className="text-sm leading-relaxed mb-6" style={{ color: "#6B82B0" }}>
            Accède au calendrier officiel FIBA 3x3 et repère les tournois disponibles autour de toi.
          </p>

          <a href={FIBA_URL} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-3 w-full py-4 rounded-xl font-display text-lg tracking-widest transition-all duration-200 active:scale-95"
            style={{
              background: "linear-gradient(135deg, #E8192C, #C0142A)",
              color: "white",
              boxShadow: "0 4px 24px rgba(232,25,44,0.35)",
              textDecoration: "none",
            }}>
            <span>🏆</span>
            RECHERCHER UN TOURNOI
            <span style={{ opacity: 0.7, fontSize: "0.8em" }}>↗</span>
          </a>

          <p className="text-center text-[10px] mt-3" style={{ color: "rgba(107,130,176,0.5)" }}>
            Ouvre le site officiel FIBA 3x3
          </p>
        </div>
      </div>

    </div>
  );
}
