"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PERSONNES,
  RARETES,
  RARETE_COLOR,
  RARETE_LABEL,
  getCarteUrl,
  type Rarete,
  type UserTypeCarte,
} from "@/lib/victorinis";
import {
  annulerEchange,
  cleCarte,
  cleUser,
  getCollections,
  getEnvoyees,
  getParticipants,
  getRecues,
  libelleCarte,
  marquerEchangeVu,
  notifierEchange,
  proposerEchange,
  repondreEchange,
  selectionVersLignes,
  type Collections,
  type Echange,
  type Ligne,
  type Participant,
  type Selection,
} from "@/lib/victorinisEchanges";

export interface Moi {
  id: string;
  type: UserTypeCarte;
}

const nomDe = (liste: Participant[], id: string, type: UserTypeCarte) => {
  const p = liste.find((x) => x.id === id && x.type === type);
  return p ? `${p.prenom} ${p.nom}` : "Quelqu'un";
};
const prenomDe = (liste: Participant[], id: string, type: UserTypeCarte) =>
  liste.find((x) => x.id === id && x.type === type)?.prenom ?? "Quelqu'un";

/* ─────────────────────────── Petits composants ─────────────────────────── */

function MiniCarte({ ligne }: { ligne: Ligne }) {
  const color = RARETE_COLOR[ligne.rarete];
  return (
    <div className="relative" style={{ width: 84 }}>
      <img
        src={getCarteUrl(ligne.personne, ligne.rarete, 200)}
        alt={libelleCarte(ligne.personne, ligne.rarete)}
        decoding="async"
        className="w-full h-auto block"
        style={{ borderRadius: 8, border: `1px solid ${color}` }}
      />
      {ligne.quantite > 1 && (
        <span
          className="absolute -top-1 -right-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold leading-none"
          style={{ background: color, color: ligne.rarete === "bleu" ? "white" : "#111" }}
        >
          ×{ligne.quantite}
        </span>
      )}
    </div>
  );
}

function CartesLigne({ lignes, vide }: { lignes: Ligne[]; vide: string }) {
  if (lignes.length === 0) {
    return (
      <p className="text-sm italic py-3" style={{ color: "var(--text-muted)" }}>
        {vide}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-3 justify-center py-2">
      {lignes.map((l) => (
        <MiniCarte key={cleCarte(l.personne, l.rarete)} ligne={l} />
      ))}
    </div>
  );
}

function Pastilles({ lignes }: { lignes: Ligne[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {lignes.map((l) => (
        <span
          key={cleCarte(l.personne, l.rarete)}
          className="text-[11px] px-2 py-1 rounded-full whitespace-nowrap"
          style={{
            border: `1px solid ${RARETE_COLOR[l.rarete]}`,
            color: "var(--text-main)",
            background: "var(--bg-input)",
          }}
        >
          {l.quantite > 1 ? `${l.quantite}× ` : ""}
          {libelleCarte(l.personne, l.rarete)}
        </span>
      ))}
    </div>
  );
}

/** Tableau 7 personnes × 3 raretés avec − / + sur chaque carte */
function Selecteur({
  value,
  onChange,
  max,
  plafond = 5,
}: {
  value: Selection;
  onChange: (v: Selection) => void;
  /** Quantités disponibles (clé "slug|rarete"). Sans max : plafond fixe. */
  max?: Selection;
  plafond?: number;
}) {
  const changer = (cle: string, delta: number, limite: number) => {
    const n = Math.max(0, Math.min(limite, (value[cle] ?? 0) + delta));
    const suivant = { ...value, [cle]: n };
    if (n === 0) delete suivant[cle];
    onChange(suivant);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 px-1">
        {RARETES.map((r) => (
          <p key={r} className="text-[10px] uppercase tracking-widest text-center" style={{ color: RARETE_COLOR[r] }}>
            {r === "bleu" ? "Bleue" : RARETE_LABEL[r]}
          </p>
        ))}
      </div>
      {PERSONNES.map((p) => (
        <div key={p.slug}>
          <p className="text-xs mb-1 px-1" style={{ color: "var(--text-sub)" }}>
            {p.prenom} {p.nom} · {p.role === "coach" ? "Coach" : `#${p.fichier}`}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {RARETES.map((r) => {
              const cle = cleCarte(p.slug, r);
              const limite = max ? max[cle] ?? 0 : plafond;
              const n = value[cle] ?? 0;
              const color = RARETE_COLOR[r];
              const dispo = limite > 0;
              return (
                <div
                  key={r}
                  className="flex items-center justify-between rounded-xl px-1"
                  style={{
                    height: 44,
                    border: `1px solid ${n > 0 ? color : "var(--border)"}`,
                    background: n > 0 ? `color-mix(in srgb, ${color} 18%, transparent)` : "var(--bg-input)",
                    opacity: dispo ? 1 : 0.35,
                  }}
                >
                  <button
                    disabled={!dispo || n === 0}
                    onClick={() => changer(cle, -1, limite)}
                    aria-label={`Retirer ${libelleCarte(p.slug, r)}`}
                    className="w-8 h-8 rounded-lg text-lg disabled:opacity-30"
                    style={{ color: "var(--text-main)" }}
                  >
                    −
                  </button>
                  <span className="text-sm font-bold" style={{ color: n > 0 ? color : "var(--text-muted)" }}>
                    {n}
                    {max && <span className="text-[10px] font-normal opacity-70">/{limite}</span>}
                  </span>
                  <button
                    disabled={!dispo || n >= limite}
                    onClick={() => changer(cle, 1, limite)}
                    aria-label={`Ajouter ${libelleCarte(p.slug, r)}`}
                    className="w-8 h-8 rounded-lg text-lg disabled:opacity-30"
                    style={{ color: "var(--text-main)" }}
                  >
                    +
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Feuille({
  titre,
  onClose,
  children,
  pied,
}: {
  titre: string;
  onClose: () => void;
  children: React.ReactNode;
  pied?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[110] flex flex-col" style={{ background: "var(--bg-base)" }}>
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <p className="font-display text-lg" style={{ color: "var(--text-main)" }}>
          {titre}
        </p>
        <button
          onClick={onClose}
          aria-label="Fermer"
          className="w-10 h-10 rounded-full text-lg"
          style={{ background: "var(--bg-input)", color: "var(--text-main)" }}
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-2xl mx-auto">{children}</div>
      </div>
      {pied && (
        <div className="px-4 py-3" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="max-w-2xl mx-auto flex gap-2">{pied}</div>
        </div>
      )}
    </div>
  );
}

const btnPlein = {
  background: "linear-gradient(135deg, #1B3A8C, #3B7BFF)",
  color: "white",
} as const;
const btnNeutre = {
  background: "var(--bg-input)",
  color: "var(--text-main)",
  border: "1px solid var(--border)",
} as const;

/* ─────────────────────── Assistant de proposition ─────────────────────── */

type Etape = "hub" | "souhait" | "destinataire" | "personne" | "cartesDe" | "offre" | "envoye";

export function EchangeModal({
  moi,
  participants,
  onClose,
  onChange,
}: {
  moi: Moi;
  participants: Participant[];
  onClose: () => void;
  onChange: () => void;
}) {
  const [etape, setEtape] = useState<Etape>("hub");
  const [souhait, setSouhait] = useState<Selection>({});
  const [cible, setCible] = useState<Participant | null>(null);
  const [offre, setOffre] = useState<Selection>({});
  const [collections, setCollections] = useState<Collections>({});
  const [envoyees, setEnvoyees] = useState<Echange[]>([]);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // true quand on est parti de la personne (et pas des cartes souhaitées)
  const [parPersonne, setParPersonne] = useState(false);

  const charger = useCallback(async () => {
    const [c, e] = await Promise.all([getCollections(), getEnvoyees(moi.id, moi.type)]);
    setCollections(c);
    setEnvoyees(e.filter((x) => x.statut === "en_attente"));
  }, [moi.id, moi.type]);

  useEffect(() => {
    charger();
  }, [charger]);

  const maCollection = collections[cleUser(moi.id, moi.type)] ?? {};
  const autres = participants.filter((p) => !(p.id === moi.id && p.type === moi.type));

  /** Ce que chaque personne peut réellement donner parmi les cartes souhaitées */
  const candidats = useMemo(() => {
    const voulu = selectionVersLignes(souhait);
    const totalVoulu = voulu.reduce((a, l) => a + l.quantite, 0);
    return autres.map((p) => {
      const coll = collections[cleUser(p.id, p.type)] ?? {};
      const lignes: Ligne[] = voulu
        .map((l) => ({ ...l, quantite: Math.min(l.quantite, coll[cleCarte(l.personne, l.rarete)] ?? 0) }))
        .filter((l) => l.quantite > 0);
      const nb = lignes.reduce((a, l) => a + l.quantite, 0);
      return { participant: p, lignes, nb, totalVoulu };
    });
  }, [souhait, collections, participants]);

  const lignesDemandees = cible
    ? candidats.find((c) => c.participant.id === cible.id && c.participant.type === cible.type)?.lignes ?? []
    : [];

  const annuler = async (id: string) => {
    await annulerEchange(id, moi.id, moi.type);
    await charger();
    onChange();
  };

  const envoyer = async () => {
    if (!cible) return;
    setEnvoi(true);
    setErreur(null);
    const res = await proposerEchange(moi, cible, selectionVersLignes(offre), lignesDemandees);
    setEnvoi(false);
    if (res.error || !res.id) {
      setErreur(res.error ?? "Une erreur est survenue");
      return;
    }
    notifierEchange(res.id);
    setSouhait({});
    setOffre({});
    await charger();
    onChange();
    setEtape("envoye");
  };

  /* ── Hub ── */
  if (etape === "hub") {
    return (
      <Feuille
        titre="ÉCHANGES"
        onClose={onClose}
        pied={
          <>
            <button
              onClick={() => {
                setParPersonne(true);
                setSouhait({});
                setEtape("personne");
              }}
              className="flex-1 py-3 rounded-xl text-sm"
              style={btnNeutre}
            >
              Voir les cartes de quelqu&apos;un
            </button>
            <button
              onClick={() => {
                setParPersonne(false);
                setSouhait({});
                setEtape("souhait");
              }}
              className="flex-1 py-3 rounded-xl text-sm font-medium"
              style={btnPlein}
            >
              Chercher des cartes
            </button>
          </>
        }
      >
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          Choisis les cartes que tu voudrais, l&apos;appli te dit qui les a, puis tu fais ta proposition.
        </p>
        <p className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--text-sub)" }}>
          Mes propositions en attente
        </p>
        {envoyees.length === 0 ? (
          <p className="text-sm italic" style={{ color: "var(--text-muted)" }}>
            Aucune pour le moment.
          </p>
        ) : (
          <div className="space-y-3">
            {envoyees.map((e) => (
              <div
                key={e.id}
                className="rounded-xl p-3"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
              >
                <p className="text-sm mb-2" style={{ color: "var(--text-main)" }}>
                  À <b>{nomDe(participants, e.a_id, e.a_type)}</b>
                </p>
                <p className="text-[11px] uppercase tracking-widest mb-1" style={{ color: "var(--text-sub)" }}>
                  Tu demandes
                </p>
                <Pastilles lignes={e.demande} />
                <p className="text-[11px] uppercase tracking-widest mt-2 mb-1" style={{ color: "var(--text-sub)" }}>
                  Tu donnes
                </p>
                {e.offre.length ? (
                  <Pastilles lignes={e.offre} />
                ) : (
                  <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>
                    Rien en échange
                  </p>
                )}
                <button
                  onClick={() => annuler(e.id)}
                  className="mt-3 px-3 py-1.5 rounded-lg text-xs"
                  style={btnNeutre}
                >
                  Annuler la proposition
                </button>
              </div>
            ))}
          </div>
        )}
      </Feuille>
    );
  }

  /* ── 1. Quelles cartes ? ── */
  if (etape === "souhait") {
    const nb = Object.values(souhait).reduce((a, b) => a + b, 0);
    return (
      <Feuille
        titre="QUELLES CARTES VEUX-TU ?"
        onClose={onClose}
        pied={
          <>
            <button onClick={() => setEtape("hub")} className="px-4 py-3 rounded-xl" style={btnNeutre}>
              Retour
            </button>
            <button
              disabled={nb === 0}
              onClick={() => setEtape("destinataire")}
              className="flex-1 py-3 rounded-xl font-medium disabled:opacity-40"
              style={btnPlein}
            >
              Qui les a ? ({nb})
            </button>
          </>
        }
      >
        <Selecteur value={souhait} onChange={setSouhait} />
      </Feuille>
    );
  }

  /* ── Choisir une personne ── */
  if (etape === "personne") {
    return (
      <Feuille
        titre="AVEC QUI ÉCHANGER ?"
        onClose={onClose}
        pied={
          <button onClick={() => setEtape("hub")} className="px-4 py-3 rounded-xl" style={btnNeutre}>
            Retour
          </button>
        }
      >
        <div className="space-y-2">
          {autres.map((p) => {
            const coll = collections[cleUser(p.id, p.type)] ?? {};
            const nb = Object.values(coll).reduce((a, b) => a + b, 0);
            const diff = Object.keys(coll).length;
            return (
              <button
                key={cleUser(p.id, p.type)}
                onClick={() => {
                  setCible(p);
                  setSouhait({});
                  setEtape("cartesDe");
                }}
                className="w-full text-left rounded-xl p-3 flex items-center justify-between transition-transform active:scale-[0.99]"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
              >
                <span className="font-medium" style={{ color: "var(--text-main)" }}>
                  {p.prenom} {p.nom}
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {nb} carte{nb > 1 ? "s" : ""} · {diff} différente{diff > 1 ? "s" : ""}
                </span>
              </button>
            );
          })}
        </div>
      </Feuille>
    );
  }

  /* ── Les cartes de la personne choisie ── */
  if (etape === "cartesDe" && cible) {
    const sesCartes = collections[cleUser(cible.id, cible.type)] ?? {};
    const nb = Object.values(souhait).reduce((a, b) => a + b, 0);
    const aDesCartes = Object.keys(sesCartes).length > 0;
    return (
      <Feuille
        titre={`LES CARTES DE ${cible.prenom.toUpperCase()}`}
        onClose={onClose}
        pied={
          <>
            <button onClick={() => setEtape("personne")} className="px-4 py-3 rounded-xl" style={btnNeutre}>
              Retour
            </button>
            <button
              disabled={nb === 0}
              onClick={() => {
                setOffre({});
                setErreur(null);
                setEtape("offre");
              }}
              className="flex-1 py-3 rounded-xl font-medium disabled:opacity-40"
              style={btnPlein}
            >
              Je les veux ({nb})
            </button>
          </>
        }
      >
        <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
          Le chiffre à droite indique combien d&apos;exemplaires {cible.prenom} possède. Choisis ceux que tu voudrais.
        </p>
        {!aDesCartes && (
          <p className="text-sm mb-3 px-3 py-2 rounded-xl" style={{ background: "var(--bg-input)", color: "var(--text-main)" }}>
            {cible.prenom} n&apos;a pas encore de carte.
          </p>
        )}
        <Selecteur value={souhait} onChange={setSouhait} max={sesCartes} />
      </Feuille>
    );
  }

  /* ── 2. Qui les a ? ── */
  if (etape === "destinataire") {
    const totalVoulu = candidats[0]?.totalVoulu ?? 0;
    const aucun = candidats.every((c) => c.nb === 0);
    return (
      <Feuille
        titre="QUI LES A ?"
        onClose={onClose}
        pied={
          <button onClick={() => setEtape("souhait")} className="px-4 py-3 rounded-xl" style={btnNeutre}>
            Modifier ma sélection
          </button>
        }
      >
        <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
          Tu veux {totalVoulu} carte{totalVoulu > 1 ? "s" : ""}. Choisis à qui faire ta proposition : elle portera sur
          les cartes qu&apos;il ou elle possède.
        </p>
        {aucun && (
          <p className="text-sm mb-3 px-3 py-2 rounded-xl" style={{ background: "var(--bg-input)", color: "var(--text-main)" }}>
            Personne ne possède ces cartes pour le moment. Essaie une autre sélection.
          </p>
        )}
        <div className="space-y-2">
          {candidats.map(({ participant: p, lignes, nb }) => (
            <button
              key={cleUser(p.id, p.type)}
              disabled={nb === 0}
              onClick={() => {
                setCible(p);
                setOffre({});
                setErreur(null);
                setEtape("offre");
              }}
              className="w-full text-left rounded-xl p-3 disabled:opacity-40 transition-transform active:scale-[0.99]"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium" style={{ color: "var(--text-main)" }}>
                  {p.prenom} {p.nom}
                </span>
                <span
                  className="text-[11px] px-2 py-0.5 rounded-full"
                  style={{
                    background: nb === totalVoulu ? "#1f7a3d" : "var(--bg-input)",
                    color: nb === totalVoulu ? "white" : "var(--text-sub)",
                  }}
                >
                  {nb === 0 ? "Aucune" : nb === totalVoulu ? "Toutes" : `${nb} sur ${totalVoulu}`}
                </span>
              </div>
              {nb > 0 && <Pastilles lignes={lignes} />}
            </button>
          ))}
        </div>
      </Feuille>
    );
  }

  /* ── 3. Que donnes-tu ? ── */
  if (etape === "offre" && cible) {
    const nbOffre = Object.values(offre).reduce((a, b) => a + b, 0);
    return (
      <Feuille
        titre={`PROPOSITION À ${cible.prenom.toUpperCase()}`}
        onClose={onClose}
        pied={
          <>
            <button
              onClick={() => setEtape(parPersonne ? "cartesDe" : "destinataire")}
              className="px-4 py-3 rounded-xl"
              style={btnNeutre}
            >
              Retour
            </button>
            <button
              disabled={envoi}
              onClick={envoyer}
              className="flex-1 py-3 rounded-xl font-medium disabled:opacity-50"
              style={btnPlein}
            >
              {envoi ? "Envoi…" : "Envoyer la proposition"}
            </button>
          </>
        }
      >
        <p className="text-[11px] uppercase tracking-widest mb-1" style={{ color: "var(--text-sub)" }}>
          Tu demandes à {cible.prenom}
        </p>
        <CartesLigne lignes={lignesDemandees} vide="" />

        <p className="text-[11px] uppercase tracking-widest mt-4 mb-2" style={{ color: "var(--text-sub)" }}>
          Que donnes-tu en échange ? ({nbOffre === 0 ? "rien" : `${nbOffre} carte${nbOffre > 1 ? "s" : ""}`})
        </p>
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          Tu peux ne rien donner, ou donner une ou plusieurs cartes parmi les tiennes.
        </p>
        <Selecteur value={offre} onChange={setOffre} max={maCollection} />

        {erreur && (
          <p className="text-sm mt-4 px-3 py-2 rounded-xl" style={{ background: "#5c1a1a", color: "white" }}>
            {erreur}
          </p>
        )}
      </Feuille>
    );
  }

  /* ── Envoyé ── */
  return (
    <Feuille
      titre="PROPOSITION ENVOYÉE"
      onClose={onClose}
      pied={
        <>
          <button onClick={() => setEtape("hub")} className="flex-1 py-3 rounded-xl" style={btnNeutre}>
            Mes propositions
          </button>
          <button onClick={onClose} className="flex-1 py-3 rounded-xl font-medium" style={btnPlein}>
            Terminé
          </button>
        </>
      }
    >
      <div className="text-center py-10">
        <p className="text-5xl mb-4">📨</p>
        <p style={{ color: "var(--text-main)" }}>
          {cible ? `${cible.prenom} va recevoir ta proposition` : "Proposition envoyée"}. Tu verras sa réponse ici à ta
          prochaine visite.
        </p>
      </div>
    </Feuille>
  );
}

/* ───────── Propositions reçues et réponses (modale à l'ouverture de la page) ───────── */

type Element =
  | { sorte: "recue"; echange: Echange }
  | { sorte: "resultat"; echange: Echange };

export function EchangesNotifs({
  moi,
  refreshKey,
  onChange,
}: {
  moi: Moi;
  refreshKey: number;
  onChange: () => void;
}) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [file, setFile] = useState<Element[]>([]);
  const [travail, setTravail] = useState(false);
  const [retour, setRetour] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    (async () => {
      const [parts, recues, envoyees] = await Promise.all([
        getParticipants(),
        getRecues(moi.id, moi.type),
        getEnvoyees(moi.id, moi.type),
      ]);
      if (annule) return;
      setParticipants(parts);
      setFile([
        ...recues.map((echange) => ({ sorte: "recue" as const, echange })),
        ...envoyees
          .filter((e) => e.statut !== "en_attente")
          .map((echange) => ({ sorte: "resultat" as const, echange })),
      ]);
    })();
    return () => {
      annule = true;
    };
  }, [moi.id, moi.type, refreshKey]);

  const courant = file[0];
  if (!courant) return null;
  const e = courant.echange;
  const suivant = () => {
    setRetour(null);
    setFile((f) => f.slice(1));
  };

  const repondre = async (accepte: boolean) => {
    setTravail(true);
    const res = await repondreEchange(e.id, moi.id, moi.type, accepte);
    setTravail(false);
    if (res.error) {
      setRetour(res.error);
      return;
    }
    if (res.statut === "acceptee") onChange();
    if (res.statut === "indisponible") {
      setRetour("Cet échange n'est plus possible : une des cartes n'est plus disponible.");
      return;
    }
    suivant();
  };

  const vu = async () => {
    await marquerEchangeVu(e.id, moi.id, moi.type);
    suivant();
  };

  const cadre = (children: React.ReactNode) => (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl p-5"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
      >
        {children}
      </div>
    </div>
  );

  if (courant.sorte === "recue") {
    const prenom = prenomDe(participants, e.de_id, e.de_type);
    return cadre(
      <>
        <p className="font-display text-xl text-center mb-1" style={{ color: "var(--text-main)" }}>
          {prenom} te propose un échange
        </p>
        {file.length > 1 && (
          <p className="text-[11px] text-center mb-2" style={{ color: "var(--text-muted)" }}>
            {file.length - 1} autre{file.length > 2 ? "s" : ""} à suivre
          </p>
        )}

        <p className="text-[11px] uppercase tracking-widest mt-3" style={{ color: "var(--text-sub)" }}>
          Tu reçois
        </p>
        <CartesLigne lignes={e.offre} vide={`${prenom} ne te donne rien en échange.`} />

        <p className="text-[11px] uppercase tracking-widest mt-2" style={{ color: "var(--text-sub)" }}>
          Tu donnes
        </p>
        <CartesLigne lignes={e.demande} vide="" />

        {retour && (
          <p className="text-sm mt-3 px-3 py-2 rounded-xl" style={{ background: "#5c1a1a", color: "white" }}>
            {retour}
          </p>
        )}

        <div className="flex gap-2 mt-4">
          {retour ? (
            <button onClick={suivant} className="flex-1 py-3 rounded-xl font-medium" style={btnPlein}>
              OK
            </button>
          ) : (
            <>
              <button
                disabled={travail}
                onClick={() => repondre(false)}
                className="flex-1 py-3 rounded-xl disabled:opacity-50"
                style={btnNeutre}
              >
                Refuser
              </button>
              <button
                disabled={travail}
                onClick={() => repondre(true)}
                className="flex-1 py-3 rounded-xl font-medium disabled:opacity-50"
                style={btnPlein}
              >
                Accepter
              </button>
            </>
          )}
        </div>
      </>
    );
  }

  // Réponse à une proposition qu'on avait envoyée
  const prenom = prenomDe(participants, e.a_id, e.a_type);
  const titre =
    e.statut === "acceptee"
      ? `${prenom} a accepté ta proposition 🎉`
      : e.statut === "refusee"
      ? `${prenom} a refusé ta proposition`
      : "Échange impossible";
  return cadre(
    <>
      <p className="font-display text-xl text-center mb-3" style={{ color: "var(--text-main)" }}>
        {titre}
      </p>
      {e.statut === "indisponible" && (
        <p className="text-sm text-center mb-3" style={{ color: "var(--text-muted)" }}>
          Une des cartes n&apos;était plus disponible au moment de répondre, rien n&apos;a été échangé.
        </p>
      )}
      {e.statut === "acceptee" && (
        <>
          <p className="text-[11px] uppercase tracking-widest" style={{ color: "var(--text-sub)" }}>
            Tu as reçu
          </p>
          <CartesLigne lignes={e.demande} vide="" />
        </>
      )}
      <button onClick={vu} className="w-full py-3 rounded-xl font-medium mt-3" style={btnPlein}>
        OK
      </button>
    </>
  );
}
