"use client";

// Petits éléments d'interface partagés pour le mode hors ligne.

/** Étiquette affichée sur une entrée enregistrée sur l'appareil mais pas encore envoyée. */
export function PendingTag() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full"
      style={{ background: "rgba(232,160,25,0.12)", border: "1px solid rgba(232,160,25,0.3)", color: "#F2C46D" }}
      title="Enregistré sur l'appareil, sera envoyé au retour du réseau"
    >
      ⏳ En attente d&apos;envoi
    </span>
  );
}

/** Message affiché après un enregistrement fait sans réseau. */
export function QueuedBanner() {
  return (
    <div
      className="rounded-lg px-4 py-3 text-sm animate-slide-in"
      style={{ background: "rgba(232,160,25,0.08)", border: "1px solid rgba(232,160,25,0.25)", color: "#F2C46D" }}
    >
      📡 Enregistré sur ton téléphone. Ce sera envoyé automatiquement dès que le réseau revient.
    </div>
  );
}
