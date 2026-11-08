"use client";

// Écran de tagging : la vidéo du match (fichier local, jamais envoyé), le clic
// sur les pieds du tireur, les modales joueur, le résultat en attente et la
// liste des actions. Plein écran, pensé pour un PC avec clavier.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Joueuse } from "@/types";
import {
  type Action, type Match, type PointCalibrage, type Resultat, type TypeAction, type Zone,
  REPERES, ZONES, appliquer, classerTir, construireCalibrage, deduireRebond, estTir,
  fmtTemps, lignesTerrain, nouvelId, score, zoneLabel, zonePourPoints,
} from "@/lib/analyse";
import Terrain, { tx } from "./Terrain";
import { ChoixJoueur, Modale, type Choix } from "./Modale";

type ModalState =
  | { kind: "menu"; t: number; pos: { x: number; y: number } | null } // clic sur la vidéo : quelle action ?
  | { kind: "tir"; t: number; x: number | null; y: number | null; points: 1 | 2 | null; zone: Zone | null }
  | { kind: "lf"; t: number }
  | { kind: "rebond"; t: number }
  | { kind: "ballon_gagne" | "ballon_perdu"; t: number }
  | { kind: "repere"; t: number; titre: string; id?: string }; // id : modification d'un repère existant

/** Une modification, enregistrée pour pouvoir l'annuler (Ctrl+Z). */
interface Op {
  crees: Action[];
  modifs: { id: string; avant: Partial<Action>; apres: Partial<Action> }[];
  supprimes: Action[];
}

const inverse = (op: Op): Op => ({
  crees: op.supprimes,
  supprimes: op.crees,
  modifs: op.modifs.map((m) => ({ id: m.id, avant: m.apres, apres: m.avant })),
});

const tri = (a: Action[]) => [...a].sort((x, y) => x.t - y.t);

const VITESSES = [0.5, 1, 1.5, 2];

const LIBELLES: Record<TypeAction, string> = {
  tir: "Tir",
  lf: "Lancer franc",
  rebond: "Rebond",
  ballon_gagne: "Ballon gagné",
  ballon_perdu: "Ballon perdu",
  repere: "Repère",
};

/** Zone de l'image réellement occupée par la vidéo (object-fit: contain), relative au conteneur. */
function boiteVideo(v: HTMLVideoElement, wrap: HTMLElement) {
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if (!v.videoWidth || !v.videoHeight || !W || !H) return null;
  const s = Math.min(W / v.videoWidth, H / v.videoHeight);
  const w = v.videoWidth * s, h = v.videoHeight * s;
  return { left: (W - w) / 2, top: (H - h) / 2, w, h };
}

export default function TaggingScreen({
  match,
  joueurs,
  onFermer,
  onMatchModifie,
  onVoirRapport,
  fichierInitial,
  onFichier,
}: {
  match: Match;
  joueurs: Joueuse[];
  onFermer: () => void;
  onMatchModifie: (m: Match) => void;
  onVoirRapport: () => void;
  fichierInitial?: File;
  onFichier: (f: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [actions, setActions] = useState<Action[]>([]);
  const [chargement, setChargement] = useState(true);
  const [videoUrl, setVideoUrl] = useState<string | null>(() => (fichierInitial ? URL.createObjectURL(fichierInitial) : null));
  const [fichierDifferent, setFichierDifferent] = useState<{ nom: string; taille: number } | null>(null);
  const [erreurVideo, setErreurVideo] = useState<string | null>(null);
  const [lecture, setLecture] = useState(false);
  const [temps, setTemps] = useState(0);
  const [duree, setDuree] = useState(0);
  const [vitesse, setVitesse] = useState(1);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [modeClic, setModeClic] = useState<"video" | "terrain">("video");
  const [voirLignes, setVoirLignes] = useState(false);
  const [calibMode, setCalibMode] = useState(false);
  const [calibPoints, setCalibPoints] = useState<PointCalibrage[]>([]);
  const [repereActif, setRepereActif] = useState<string>(REPERES[0].id);
  const [toast, setToast] = useState<{ texte: string; erreur?: boolean } | null>(null);
  const [rebondForce, setRebondForce] = useState<"off" | "def" | null>(null);
  const [filtreListe, setFiltreListe] = useState<"tout" | "reperes">("tout");

  const undoRef = useRef<Op[]>([]);
  const modalRef = useRef<ModalState | null>(null);
  const relancerRef = useRef(false);
  modalRef.current = modal;

  const calibrage = useMemo(() => construireCalibrage(match.calibration), [match.calibration]);
  const debut = match.video_debut ?? 0;
  const effectif = useMemo(() => {
    const liste = match.effectif.map((id) => joueurs.find((j) => j.id === id) ?? ({ id, prenom: "Joueur", nom: "" } as Joueuse));
    return liste.map((j) => {
      const homonyme = liste.some((o) => o.id !== j.id && o.prenom === j.prenom);
      return {
        id: j.id,
        label: homonyme ? `${j.prenom} ${j.nom.charAt(0)}.` : j.prenom,
        initiales: `${j.prenom.charAt(0)}${j.nom.charAt(0)}`.toUpperCase(),
      };
    });
  }, [match.effectif, joueurs]);
  const nomDe = useCallback(
    (a: Action) => (a.equipe === "adversaire" ? match.adversaire || "Adversaire" : effectif.find((e) => e.id === a.joueuse_id)?.label ?? "?"),
    [effectif, match.adversaire],
  );
  const avecAdversaire = match.mode_adversaire !== "aucun";

  // ─── Chargement ──────────────────────────────────────────────────────────

  useEffect(() => {
    try {
      const m = localStorage.getItem("analyse_mode_clic");
      if (m === "video" || m === "terrain") setModeClic(m);
    } catch { /* stockage indisponible */ }
    supabase
      .from("analyse_actions")
      .select("*")
      .eq("match_id", match.id)
      .order("t", { ascending: true })
      .then(({ data, error }) => {
        if (error) setToast({ texte: "Impossible de charger les actions du match. Vérifie la connexion.", erreur: true });
        setActions((data ?? []) as Action[]);
        setChargement(false);
      });
  }, [match.id]);


  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.erreur ? 7000 : 2500);
    return () => clearTimeout(id);
  }, [toast]);

  const changerModeClic = (m: "video" | "terrain") => {
    setModeClic(m);
    try { localStorage.setItem("analyse_mode_clic", m); } catch { /* ignoré */ }
  };

  // ─── Enregistrement ──────────────────────────────────────────────────────

  /** Applique une modification à l'écran (sans toucher à la base). */
  const appliquerLocal = useCallback((op: Op) => {
    setActions((prev) => {
      const sup = new Set(op.supprimes.map((a) => a.id));
      let next = prev.filter((a) => !sup.has(a.id));
      next = next.map((a) => {
        const m = op.modifs.find((x) => x.id === a.id);
        return m ? { ...a, ...m.apres } : a;
      });
      return tri([...next, ...op.crees]);
    });
  }, []);

  // Les écritures partent l'une après l'autre : un « Rentré » tapé juste après
  // le tir ne doit pas arriver en base avant la création du tir.
  const fileEcritures = useRef<Promise<void>>(Promise.resolve());

  const appliquerOp = useCallback((op: Op, memoriser = true) => {
    appliquerLocal(op);
    if (memoriser) undoRef.current.push(op);
    fileEcritures.current = fileEcritures.current.then(async () => {
      try {
        if (op.supprimes.length) {
          const { error } = await supabase.from("analyse_actions").delete().in("id", op.supprimes.map((a) => a.id));
          if (error) throw error;
        }
        if (op.crees.length) {
          const { error } = await supabase.from("analyse_actions").insert(op.crees);
          if (error) throw error;
        }
        for (const m of op.modifs) {
          const { error } = await supabase.from("analyse_actions").update(m.apres).eq("id", m.id);
          if (error) throw error;
        }
      } catch (err) {
        console.error("[Analyse] enregistrement", err);
        // On retire de l'écran ce qui n'a pas été enregistré, pour ne pas laisser croire que c'est sauvé.
        appliquerLocal(inverse(op));
        if (memoriser) undoRef.current = undoRef.current.filter((o) => o !== op);
        setToast({ texte: "Pas de connexion : l'action n'a pas été enregistrée et a été retirée. Refais-la.", erreur: true });
      }
    });
  }, [appliquerLocal]);

  const annulerDerniere = useCallback(() => {
    const op = undoRef.current.pop();
    if (!op) { setToast({ texte: "Rien à annuler" }); return; }
    appliquerOp(inverse(op), false);
    setToast({ texte: "Dernière action annulée" });
  }, [appliquerOp]);

  const majMatch = useCallback(async (patch: Partial<Match>) => {
    onMatchModifie({ ...match, ...patch });
    const { error } = await supabase
      .from("analyse_matchs")
      .update({ ...patch, modifie_le: new Date().toISOString() })
      .eq("id", match.id);
    if (error) setToast({ texte: "Modification du match non enregistrée. Vérifie la connexion.", erreur: true });
  }, [match, onMatchModifie]);

  // ─── Vidéo ───────────────────────────────────────────────────────────────

  const choisirFichier = (f: File | undefined) => {
    if (!f) return;
    setErreurVideo(null);
    // L'URL précédente ne sert plus (le File reste gardé par l'onglet pour le retour depuis les stats)
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(f));
    repriseFaite.current = false;
    onFichier(f);
    if (!match.video_nom) majMatch({ video_nom: f.name, video_taille: f.size });
    else if (match.video_nom !== f.name || Number(match.video_taille) !== f.size) setFichierDifferent({ nom: f.name, taille: f.size });
    else setFichierDifferent(null);
  };

  // Reprise : à la dernière action taguée, sinon au début du match.
  // Attend que la vidéo et les actions soient chargées (l'ordre varie).
  const repriseFaite = useRef(false);
  const reprendre = useCallback(() => {
    const v = videoRef.current;
    if (repriseFaite.current || chargement || !v || !v.duration) return;
    repriseFaite.current = true;
    const reprise = actions.length ? actions[actions.length - 1].t : debut;
    if (reprise > 0 && reprise < v.duration) v.currentTime = reprise;
  }, [actions, chargement, debut]);
  useEffect(() => { reprendre(); }, [reprendre]);

  const onMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    setDuree(v.duration || 0);
    v.playbackRate = vitesse;
    reprendre();
    dessiner();
  };

  const onErreurVideo = () => {
    setErreurVideo(
      "Le navigateur ne sait pas lire ce fichier. C'est souvent le cas des vidéos HEVC (H.265) ou .MTS. Convertis-la en MP4 (H.264), par exemple avec HandBrake, puis rouvre-la.",
    );
  };

  const basculerLecture = useCallback(() => {
    const v = videoRef.current;
    if (!v || !videoUrl) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }, [videoUrl]);

  const avancer = useCallback((s: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min((v.duration || 0) - 0.05, v.currentTime + s));
  }, []);

  const allerA = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, t);
  };

  // ─── Modales ─────────────────────────────────────────────────────────────

  const ouvrir = useCallback((m: ModalState) => {
    const v = videoRef.current;
    relancerRef.current = !!v && !v.paused;
    v?.pause();
    setRebondForce(null);
    setModal(m);
  }, []);

  const fermer = useCallback((relancer: boolean) => {
    setModal(null);
    if (relancer && relancerRef.current) videoRef.current?.play().catch(() => {});
  }, []);

  /** Change de modale sans toucher à la lecture (la vidéo est déjà en pause). */
  const passerA = useCallback((m: ModalState) => {
    setRebondForce(null);
    setModal(m);
  }, []);

  const tempsCourant = () => videoRef.current?.currentTime ?? 0;

  const ouvrirTir = useCallback((pos: { x: number; y: number } | null) => {
    const t = videoRef.current?.currentTime ?? 0;
    if (pos) {
      const c = classerTir(pos.x, pos.y);
      ouvrir({ kind: "tir", t, x: pos.x, y: pos.y, points: c.points, zone: c.zone });
    } else {
      ouvrir({ kind: "tir", t, x: null, y: null, points: null, zone: null });
    }
  }, [ouvrir]);

  const baseAction = (t: number, type: TypeAction): Action => ({
    id: nouvelId(), match_id: match.id, t: Math.round(t * 100) / 100, type, equipe: "nous",
    joueuse_id: null, points: null, zone: null, x: null, y: null, resultat: null, rebond: null,
  });

  const qui = (id: string) => (id === "adversaire" ? { equipe: "adversaire" as const, joueuse_id: null } : { equipe: "nous" as const, joueuse_id: id });

  const validerTir = (id: string) => {
    if (modal?.kind !== "tir" || !modal.points) return;
    const w = qui(id);
    const garderPosition = w.equipe === "nous" || match.mode_adversaire === "position";
    const a: Action = {
      ...baseAction(modal.t, "tir"), ...w,
      points: modal.points,
      zone: garderPosition ? modal.zone : null,
      x: garderPosition && modal.x !== null ? Math.round(modal.x * 100) / 100 : null,
      y: garderPosition && modal.y !== null ? Math.round(modal.y * 100) / 100 : null,
      resultat: "attente",
    };
    appliquerOp({ crees: [a], modifs: [], supprimes: [] });
    fermer(true);
  };

  const validerLF = (id: string) => {
    if (modal?.kind !== "lf") return;
    const a: Action = { ...baseAction(modal.t, "lf"), ...qui(id), points: 1, resultat: "attente" };
    appliquerOp({ crees: [a], modifs: [], supprimes: [] });
    fermer(true);
  };

  const validerRebond = (id: string) => {
    if (modal?.kind !== "rebond") return;
    const w = qui(id);
    const type = rebondForce ?? deduireRebond(actions, modal.t, w.equipe);
    if (!type) return;
    const a: Action = { ...baseAction(modal.t, "rebond"), ...w, rebond: type };
    // Un rebond tranche le tir resté en attente juste avant : il était raté.
    const attente = [...actions].reverse().find((x) => estTir(x) && x.resultat === "attente" && x.t <= modal.t + 0.01 && modal.t - x.t <= 10);
    appliquerOp({
      crees: [a],
      modifs: attente ? [{ id: attente.id, avant: { resultat: "attente" }, apres: { resultat: "rate" } }] : [],
      supprimes: [],
    });
    if (attente) setToast({ texte: `Tir de ${nomDe(attente)} passé en raté` });
    fermer(true);
  };

  const validerBallon = (id: string) => {
    if (modal?.kind !== "ballon_gagne" && modal?.kind !== "ballon_perdu") return;
    const a: Action = { ...baseAction(modal.t, modal.kind), ...qui(id) };
    appliquerOp({ crees: [a], modifs: [], supprimes: [] });
    fermer(true);
  };

  const validerRepere = (titreSaisi: string) => {
    if (modal?.kind !== "repere") return;
    const titre = titreSaisi.trim() || null;
    if (modal.id) {
      const avant = actions.find((a) => a.id === modal.id);
      if (avant) appliquerOp({ crees: [], supprimes: [], modifs: [{ id: modal.id, avant: { titre: avant.titre ?? null }, apres: { titre } }] });
      setModal(null);
      return;
    }
    appliquerOp({ crees: [{ ...baseAction(modal.t, "repere"), titre }], modifs: [], supprimes: [] });
    fermer(true);
  };

  const reperes = useMemo(() => actions.filter((a) => a.type === "repere"), [actions]);
  /** Titres déjà utilisés, du plus récent au plus ancien, pour les retrouver en un clic. */
  const titresRecents = useMemo(() => {
    const vus: string[] = [];
    for (const a of [...reperes].sort((x, y) => y.t - x.t)) {
      if (a.titre && !vus.includes(a.titre)) vus.push(a.titre);
      if (vus.length >= 6) break;
    }
    return vus;
  }, [reperes]);

  // ─── Résultat en attente ─────────────────────────────────────────────────

  const enAttente = useMemo(
    () => actions.filter((a) => estTir(a) && a.resultat === "attente").sort((a, b) => b.t - a.t),
    [actions],
  );

  const trancher = useCallback((a: Action | undefined, r: Resultat) => {
    if (!a) return;
    appliquerOp({ crees: [], supprimes: [], modifs: [{ id: a.id, avant: { resultat: a.resultat }, apres: { resultat: r } }] });
  }, [appliquerOp]);

  // ─── Clic sur la vidéo ───────────────────────────────────────────────────

  const clicVideo = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current, wrap = wrapRef.current;
    if (!v || !wrap || !videoUrl) return;
    const b = boiteVideo(v, wrap);
    if (!b) return;
    const r = wrap.getBoundingClientRect();
    const u = (e.clientX - r.left - b.left) / b.w;
    const vv = (e.clientY - r.top - b.top) / b.h;
    if (u < 0 || u > 1 || vv < 0 || vv > 1) return;

    if (calibMode) {
      const next = [...calibPoints.filter((p) => p.id !== repereActif), { id: repereActif, u, v: vv }];
      setCalibPoints(next);
      const suivant = REPERES.find((rp) => !next.some((p) => p.id === rp.id));
      if (suivant) setRepereActif(suivant.id);
      return;
    }

    // Position du clic sur le terrain, gardée au cas où l'action est un tir
    let pos: { x: number; y: number } | null = null;
    if (modeClic === "video" && calibrage) {
      const p = appliquer(calibrage.versTerrain, u, vv);
      if (p && p.x >= -8 && p.x <= 8 && p.y >= -0.5 && p.y <= 11.5) {
        pos = { x: Math.max(-7.5, Math.min(7.5, p.x)), y: Math.max(0, Math.min(11, p.y)) };
      }
    }
    ouvrir({ kind: "menu", t: v.currentTime, pos });
  };

  /** Choix fait dans le menu ouvert par le clic sur la vidéo. */
  const choisirAction = useCallback((kind: "tir" | "lf" | "rebond" | "ballon_gagne" | "ballon_perdu" | "repere" | "reussi" | "rate") => {
    const m = modalRef.current;
    if (m?.kind !== "menu") return;
    if (kind === "reussi" || kind === "rate") {
      trancher(enAttente[0], kind);
      fermer(true);
      return;
    }
    if (kind === "tir") {
      if (m.pos) {
        const c = classerTir(m.pos.x, m.pos.y);
        passerA({ kind: "tir", t: m.t, x: m.pos.x, y: m.pos.y, points: c.points, zone: c.zone });
      } else {
        passerA({ kind: "tir", t: m.t, x: null, y: null, points: null, zone: null });
      }
    } else if (kind === "repere") passerA({ kind: "repere", t: m.t, titre: "" });
    else passerA({ kind, t: m.t });
  }, [passerA, fermer, trancher, enAttente]);

  // ─── Lignes du terrain et repères sur la vidéo ───────────────────────────

  const dessiner = useCallback(() => {
    const cv = canvasRef.current, v = videoRef.current, wrap = wrapRef.current;
    if (!cv || !v || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const b = boiteVideo(v, wrap);
    if (!b) return;
    const px = (u: number, vv: number) => [b.left + u * b.w, b.top + vv * b.h] as const;
    const cal = calibMode ? construireCalibrage(calibPoints) : calibrage;
    if ((calibMode || voirLignes) && cal) {
      ctx.strokeStyle = "rgba(196,154,40,0.9)";
      ctx.lineWidth = 2;
      for (const poly of lignesTerrain()) {
        ctx.beginPath();
        let enCours = false;
        for (const p of poly) {
          const q = appliquer(cal.versImage, p.x, p.y);
          if (!q || Math.abs(q.x) > 4 || Math.abs(q.y) > 4) { enCours = false; continue; }
          const [x, y] = px(q.x, q.y);
          if (enCours) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          enCours = true;
        }
        ctx.stroke();
      }
    }
    if (calibMode) {
      ctx.font = "600 12px 'DM Sans', sans-serif";
      for (const p of calibPoints) {
        const [x, y] = px(p.u, p.v);
        const n = REPERES.findIndex((r) => r.id === p.id) + 1;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fillStyle = p.id === repereActif ? "#C49A28" : "#22c55e";
        ctx.fill();
        ctx.strokeStyle = "#07090E"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(String(n), x + 10, y - 8);
      }
    }
  }, [calibMode, calibPoints, calibrage, voirLignes, repereActif]);

  useEffect(() => { dessiner(); }, [dessiner]);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => dessiner());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [dessiner]);

  const marquerDebut = () => {
    if (!videoUrl) { setToast({ texte: "Choisis d'abord la vidéo du match" }); return; }
    const t = Math.round(tempsCourant() * 10) / 10;
    majMatch({ video_debut: t });
    setToast({ texte: `Début du match placé à ${fmtTemps(t)} dans la vidéo` });
  };

  const ouvrirCalibrage = () => {
    videoRef.current?.pause();
    const pts = match.calibration ?? [];
    setCalibPoints(pts);
    setRepereActif((REPERES.find((r) => !pts.some((p) => p.id === r.id)) ?? REPERES[0]).id);
    setCalibMode(true);
  };
  const calibEnCours = useMemo(() => construireCalibrage(calibPoints), [calibPoints]);
  const enregistrerCalibrage = async () => {
    if (!calibEnCours) return;
    await majMatch({ calibration: calibPoints });
    setCalibMode(false);
    changerModeClic("video");
    setToast({ texte: "Calibrage enregistré : clique sur les pieds du tireur" });
  };

  // ─── Clavier ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement;
      // Les champs texte gardent le clavier ; la barre de lecture (range) le laisse aux raccourcis
      const estRange = cible?.tagName === "INPUT" && (cible as HTMLInputElement).type === "range";
      if (cible && !estRange && (cible.tagName === "INPUT" || cible.tagName === "SELECT" || cible.tagName === "TEXTAREA")) return;
      if (modalRef.current) return; // la modale gère ses propres touches
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); annulerDerniere(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " ") { e.preventDefault(); basculerLecture(); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); avancer(e.shiftKey ? -1 : -5); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); avancer(e.shiftKey ? 1 : 5); return; }
      if (calibMode) { if (e.key === "Escape") setCalibMode(false); return; }
      if (!videoUrl) return;
      const t = videoRef.current?.currentTime ?? 0;
      // Empêche la lettre du raccourci d'arriver dans le champ qui s'ouvre (titre du repère)
      if (["t", "l", "b", "g", "p", "n", "r", "m"].includes(k)) e.preventDefault();
      if (k === "t") ouvrirTir(null);
      else if (k === "l") ouvrir({ kind: "lf", t });
      else if (k === "b") ouvrir({ kind: "rebond", t });
      else if (k === "g") ouvrir({ kind: "ballon_gagne", t });
      else if (k === "p") ouvrir({ kind: "ballon_perdu", t });
      else if (k === "n") ouvrir({ kind: "repere", t, titre: "" });
      else if (k === "r") trancher(enAttente[0], "reussi");
      else if (k === "m") trancher(enAttente[0], "rate");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [annulerDerniere, basculerLecture, avancer, calibMode, videoUrl, ouvrirTir, ouvrir, trancher, enAttente]);

  // ─── Rendu ───────────────────────────────────────────────────────────────

  const sc = score(actions);
  const titre = `${match.adversaire ? `vs ${match.adversaire}` : "Match"} · ${new Date(match.date_match + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`;

  const choix = (opts: { adversaire: boolean; info?: (id: string) => string | undefined }): Choix[] => [
    ...effectif.map((e) => ({ id: e.id, label: e.label, initiales: e.initiales, info: opts.info?.(e.id) })),
    ...(opts.adversaire ? [{ id: "adversaire", label: match.adversaire || "Adversaire", initiales: "ADV", adversaire: true, info: opts.info?.("adversaire") }] : []),
  ];

  const boutonsActions: { kind: "tir" | ModalState["kind"]; label: string; touche: string; couleur: string }[] = [
    { kind: "tir", label: "Tir", touche: "T", couleur: "var(--primary-light)" },
    { kind: "lf", label: "Lancer franc", touche: "L", couleur: "var(--primary-light)" },
    { kind: "rebond", label: "Rebond", touche: "B", couleur: "#C49A28" },
    { kind: "ballon_gagne", label: "Ballon gagné", touche: "G", couleur: "#22c55e" },
    { kind: "ballon_perdu", label: "Ballon perdu", touche: "P", couleur: "#ef4444" },
    { kind: "repere", label: "Repère (titre libre)", touche: "N", couleur: "var(--text-sub)" },
  ];

  const clicBouton = (kind: (typeof boutonsActions)[number]["kind"]) => {
    if (!videoUrl) { setToast({ texte: "Choisis d'abord la vidéo du match" }); return; }
    if (kind === "tir") ouvrirTir(null);
    else if (kind === "repere") ouvrir({ kind, t: tempsCourant(), titre: "" });
    else ouvrir({ kind, t: tempsCourant() } as ModalState);
  };

  const detailAction = (a: Action) => {
    if (a.type === "tir") return `${a.points} pt${a.points === 2 ? "s" : ""}${a.zone ? ` · ${ZONES.find((z) => z.id === a.zone)?.court}` : ""}`;
    if (a.type === "rebond") return a.rebond === "off" ? "Offensif" : "Défensif";
    return "";
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: "var(--bg-base)" }}>
      {/* ── Barre du haut ── */}
      <header
        className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5"
        style={{
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-card)",
          paddingLeft: "max(16px, env(safe-area-inset-left, 0px))",
          paddingRight: "max(16px, env(safe-area-inset-right, 0px))",
        }}
      >
        <button onClick={onFermer} className="hover-text-main text-sm font-medium" style={{ color: "var(--text-sub)" }}>
          ← Matchs
        </button>
        <div className="min-w-0">
          <p className="font-display text-xl leading-none truncate" style={{ color: "var(--text-main)" }}>{titre}</p>
          {match.competition && <p className="text-[11px] uppercase tracking-widest" style={{ color: "var(--text-sub)" }}>{match.competition}</p>}
        </div>
        <div
          className="flex items-center gap-3 px-3 py-1 rounded-lg font-display text-2xl"
          style={{ background: "var(--bg-input)", border: "1px solid var(--border)", fontVariantNumeric: "tabular-nums" }}
          aria-label="Score"
        >
          <span style={{ color: "var(--text-sub)", fontSize: "0.8rem" }}>FRA</span>
          <span style={{ color: "var(--accent)" }}>{sc.nous}</span>
          <span style={{ color: "var(--text-muted)" }}>–</span>
          <span style={{ color: "var(--text-main)" }}>{avecAdversaire ? sc.adversaire : "·"}</span>
          <span style={{ color: "var(--text-sub)", fontSize: "0.8rem" }}>ADV</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <div className="flex rounded-lg p-0.5" style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }} role="group" aria-label="Position des tirs">
            {(["video", "terrain"] as const).map((m) => (
              <button
                key={m}
                onClick={() => changerModeClic(m)}
                className="px-2.5 py-1 rounded-md text-xs font-medium"
                style={modeClic === m ? { background: "var(--primary)", color: "white" } : { color: "var(--text-muted)" }}
                title={m === "video" ? "Pour un tir, le clic sur les pieds du tireur donne la position (calibrage requis)" : "La position d'un tir se place sur un terrain dessiné"}
              >
                {m === "video" ? "Position au clic" : "Position sur schéma"}
              </button>
            ))}
          </div>
          <BarreBouton onClick={ouvrirCalibrage} actif={!!calibrage}>{calibrage ? "Recalibrer" : "Calibrer le terrain"}</BarreBouton>
          {calibrage && <BarreBouton onClick={() => setVoirLignes((s) => !s)} actif={voirLignes}>Lignes</BarreBouton>}
          <BarreBouton onClick={marquerDebut} title="Marque l'instant actuel comme début du match (vidéo d'une journée entière)">
            Début du match ici
          </BarreBouton>
          <BarreBouton onClick={() => fileRef.current?.click()}>Vidéo…</BarreBouton>
          <BarreBouton onClick={onVoirRapport} accent>Stats</BarreBouton>
        </div>
        <input ref={fileRef} type="file" accept="video/*" className="hidden" id="analyse-video-file" onChange={(e) => { choisirFichier(e.target.files?.[0]); e.target.value = ""; }} />
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* ── Vidéo ── */}
        <section className="flex-1 min-w-0 min-h-0 flex flex-col">
          {fichierDifferent && (
            <div className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm" style={{ background: "rgba(239,68,68,0.1)", borderBottom: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5" }}>
              <span className="flex-1 min-w-0">
                Ce fichier ({fichierDifferent.nom}) n&apos;est pas la vidéo utilisée la dernière fois ({match.video_nom}). Les actions déjà taguées risquent de ne plus tomber au bon moment.
              </span>
              <button className="underline" onClick={() => { majMatch({ video_nom: fichierDifferent.nom, video_taille: fichierDifferent.taille }); setFichierDifferent(null); }}>
                C&apos;est la bonne vidéo
              </button>
            </div>
          )}

          <div ref={wrapRef} className="relative flex-1 min-h-[240px]" style={{ background: "#000" }}>
            {videoUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  className="absolute inset-0 w-full h-full"
                  style={{ objectFit: "contain" }}
                  playsInline
                  onLoadedMetadata={onMetadata}
                  onTimeUpdate={(e) => setTemps(e.currentTarget.currentTime)}
                  onPlay={() => setLecture(true)}
                  onPause={() => setLecture(false)}
                  onError={onErreurVideo}
                />
                <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
                <div
                  className="absolute inset-0"
                  style={{ cursor: "crosshair" }}
                  onClick={clicVideo}
                  title={calibMode ? "Clique sur le repère sélectionné" : "Clic dès qu'il se passe quelque chose (pour un tir : sur les pieds du tireur)"}
                />
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="font-display text-3xl" style={{ color: "var(--text-main)" }}>Vidéo du match</p>
                <p className="text-sm max-w-md" style={{ color: "var(--text-sub)" }}>
                  Le fichier reste sur ton PC : il est lu directement, rien n&apos;est envoyé.
                  {match.video_nom && <><br />Dernière vidéo utilisée : <strong style={{ color: "var(--text-main)" }}>{match.video_nom}</strong></>}
                </p>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="hover-lift px-5 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white", boxShadow: "0 2px 12px var(--accent-glow)" }}
                >
                  Choisir la vidéo
                </button>
              </div>
            )}

            {erreurVideo && (
              <div className="absolute inset-x-4 top-4 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(127,29,29,0.92)", color: "#fee2e2" }}>
                {erreurVideo}
              </div>
            )}

            {/* Résultat en attente */}
            {enAttente.length > 0 && !calibMode && (
              <div
                className="absolute left-1/2 -translate-x-1/2 top-3 flex flex-wrap items-center justify-center gap-2 rounded-xl px-3 py-2 animate-slide-in"
                style={{ background: "rgba(7,9,14,0.88)", border: "1px solid rgba(245,158,11,0.5)", maxWidth: "calc(100% - 24px)" }}
              >
                <span className="text-sm" style={{ color: "#fcd34d" }}>
                  {enAttente[0].type === "lf" ? "LF" : `Tir ${enAttente[0].points} pt${enAttente[0].points === 2 ? "s" : ""}`} · <strong>{nomDe(enAttente[0])}</strong>
                </span>
                <button onClick={() => trancher(enAttente[0], "reussi")} className="px-3 py-1 rounded-lg text-sm font-semibold" style={{ background: "#16a34a", color: "white" }}>
                  ✓ Rentré <kbd className="opacity-70 text-xs" style={{ fontFamily: "inherit" }}>R</kbd>
                </button>
                <button onClick={() => trancher(enAttente[0], "rate")} className="px-3 py-1 rounded-lg text-sm font-semibold" style={{ background: "#b91c1c", color: "white" }}>
                  ✗ Raté <kbd className="opacity-70 text-xs" style={{ fontFamily: "inherit" }}>M</kbd>
                </button>
                {enAttente.length > 1 && <span className="text-xs" style={{ color: "var(--text-sub)" }}>+{enAttente.length - 1} en attente</span>}
              </div>
            )}

            {toast && (
              <div
                className="absolute left-1/2 -translate-x-1/2 bottom-4 rounded-lg px-4 py-2 text-sm animate-fade-in-up"
                style={{ background: toast.erreur ? "rgba(127,29,29,0.95)" : "rgba(15,21,32,0.95)", color: toast.erreur ? "#fee2e2" : "var(--text-main)", border: "1px solid var(--border)", maxWidth: "calc(100% - 32px)" }}
                role="status"
              >
                {toast.texte}
              </div>
            )}
          </div>

          {/* Commandes de lecture */}
          <div
            className="flex flex-wrap items-center gap-3 py-2"
            style={{ borderTop: "1px solid var(--border)", background: "var(--bg-card)", paddingLeft: "max(16px, env(safe-area-inset-left, 0px))", paddingRight: "max(16px, env(safe-area-inset-right, 0px))" }}
          >
            <button onClick={() => avancer(-5)} className="icon-btn w-9 h-9 rounded-lg text-xs" title="Reculer de 5 s (←)" aria-label="Reculer de 5 secondes">−5</button>
            <button
              onClick={basculerLecture}
              className="w-11 h-9 rounded-lg text-sm font-semibold"
              style={{ background: "var(--primary)", color: "white" }}
              aria-label={lecture ? "Pause" : "Lecture"}
              title="Espace"
            >
              {lecture ? "❚❚" : "▶"}
            </button>
            <button onClick={() => avancer(5)} className="icon-btn w-9 h-9 rounded-lg text-xs" title="Avancer de 5 s (→)" aria-label="Avancer de 5 secondes">+5</button>
            <span className="text-sm" style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-main)" }}>
              {fmtTemps(temps - debut)}
              <span style={{ color: "var(--text-muted)" }}> · vidéo {fmtTemps(temps)} / {fmtTemps(duree)}</span>
            </span>
            <div className="relative flex-1 min-w-[120px] flex items-center">
              <input
                id="analyse-seek"
                type="range"
                min={0}
                max={duree || 0}
                step={0.1}
                value={Math.min(temps, duree || 0)}
                onChange={(e) => allerA(Number(e.target.value))}
                className="w-full"
                aria-label="Position dans la vidéo"
              />
              {/* Repères sur la barre de lecture */}
              {duree > 0 && reperes.map((a) => (
                <button
                  key={a.id}
                  onClick={() => allerA(a.t - 2)}
                  className="absolute -top-2.5 w-2.5 h-2.5 -translate-x-1/2 rotate-45 rounded-[2px]"
                  style={{ left: `${Math.min(100, Math.max(0, (a.t / duree) * 100))}%`, background: "var(--accent)", border: "1px solid var(--bg-base)" }}
                  title={`${fmtTemps(a.t - debut)} · ${a.titre || "Repère"}`}
                  aria-label={`Aller au repère ${a.titre || "sans titre"}`}
                />
              ))}
            </div>
            <select
              id="analyse-vitesse"
              value={vitesse}
              onChange={(e) => { const s = Number(e.target.value); setVitesse(s); if (videoRef.current) videoRef.current.playbackRate = s; e.currentTarget.blur(); }}
              className="rounded-lg px-2 py-1.5 text-xs"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)" }}
              aria-label="Vitesse de lecture"
            >
              {VITESSES.map((s) => <option key={s} value={s}>×{s}</option>)}
            </select>
          </div>
        </section>

        {/* ── Panneau latéral ── */}
        <aside
          className="lg:w-[340px] shrink-0 flex flex-col min-h-0 max-h-[50vh] lg:max-h-none"
          style={{ borderLeft: "1px solid var(--border)", background: "var(--bg-card)" }}
        >
          {calibMode ? (
            <PanneauCalibrage
              points={calibPoints}
              actif={repereActif}
              onActif={setRepereActif}
              erreurCm={calibEnCours?.erreurCm ?? null}
              valide={!!calibEnCours}
              onEffacer={() => { setCalibPoints([]); setRepereActif(REPERES[0].id); }}
              onRetirer={(id) => setCalibPoints((p) => p.filter((x) => x.id !== id))}
              onAnnuler={() => setCalibMode(false)}
              onEnregistrer={enregistrerCalibrage}
            />
          ) : (
            <>
              <div className="p-3 grid grid-cols-2 gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
                {boutonsActions.map((b) => (
                  <button
                    key={b.kind}
                    onClick={() => clicBouton(b.kind)}
                    className={`hover-lift flex items-center justify-between gap-2 px-3 py-3 rounded-xl text-sm font-semibold text-left ${b.kind === "tir" || b.kind === "repere" ? "col-span-2" : ""}`}
                    style={{ background: `color-mix(in srgb, ${b.couleur} 14%, var(--bg-card2))`, border: `1px solid color-mix(in srgb, ${b.couleur} 40%, transparent)`, color: "var(--text-main)" }}
                  >
                    <span>{b.label}</span>
                    <kbd className="text-xs px-1.5 rounded" style={{ border: "1px solid var(--border)", color: "var(--text-sub)", fontFamily: "inherit" }}>{b.touche}</kbd>
                  </button>
                ))}
                <p className="col-span-2 text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
                  Clic sur la vidéo dès qu&apos;il se passe quelque chose, puis choix de l&apos;action.{" "}
                  {modeClic === "video" && calibrage
                    ? "Pour un tir, clique sur les pieds du tireur : la position est prise au clic."
                    : modeClic === "video"
                    ? "Calibre le terrain pour que la position d'un tir soit prise au clic."
                    : "La position d'un tir se place sur le terrain dessiné."}
                  {" "}Les lettres marchent aussi sans clic. Espace : pause · ← → : 5 s · Ctrl+Z : annuler
                </p>
              </div>

              <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-1">
                <div className="flex rounded-lg p-0.5" style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }} role="group" aria-label="Filtrer la liste">
                  {([["tout", `Actions · ${actions.length - reperes.length}`], ["reperes", `Repères · ${reperes.length}`]] as const).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setFiltreListe(id)}
                      className="px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap"
                      style={filtreListe === id ? { background: "var(--primary)", color: "white" } : { color: "var(--text-muted)" }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button onClick={annulerDerniere} className="hover-text-main text-xs whitespace-nowrap" style={{ color: "var(--text-sub)" }}>Annuler la dernière</button>
              </div>
              <ol className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 space-y-1" aria-label="Actions taguées">
                {chargement && <li className="px-2 py-3 text-sm" style={{ color: "var(--text-muted)" }}>Chargement…</li>}
                {!chargement && actions.length === 0 && filtreListe === "tout" && (
                  <li className="px-2 py-3 text-sm" style={{ color: "var(--text-muted)" }}>
                    Aucune action pour l&apos;instant. Lance la vidéo et clique au moment du premier tir.
                  </li>
                )}
                {!chargement && reperes.length === 0 && filtreListe === "reperes" && (
                  <li className="px-2 py-3 text-sm" style={{ color: "var(--text-muted)" }}>
                    Aucun repère. Appuie sur N pour marquer un moment à revoir et lui donner un titre.
                  </li>
                )}
                {(filtreListe === "reperes" ? reperes : actions).slice().reverse().map((a) => a.type === "repere" ? (
                  <li key={a.id}>
                    <div
                      className="group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer"
                      style={{ background: "color-mix(in srgb, var(--accent) 7%, transparent)", borderLeft: "2px solid var(--accent)" }}
                      onClick={() => allerA(a.t - 2)}
                      title="Revoir ce moment"
                    >
                      <span className="text-xs w-12 shrink-0" style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{fmtTemps(a.t - debut)}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm truncate" style={{ color: a.titre ? "var(--text-main)" : "var(--text-muted)" }}>{a.titre || "Sans titre"}</span>
                        <span className="block text-xs" style={{ color: "var(--accent)" }}>⚑ Repère</span>
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); ouvrir({ kind: "repere", t: a.t, titre: a.titre ?? "", id: a.id }); }}
                        className="icon-btn w-7 h-7 rounded-md text-xs shrink-0 opacity-60 group-hover:opacity-100"
                        aria-label="Modifier le titre"
                        title="Modifier le titre"
                      >
                        ✎
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); appliquerOp({ crees: [], modifs: [], supprimes: [a] }); }}
                        className="icon-btn icon-btn-danger w-7 h-7 rounded-md text-xs shrink-0 opacity-60 group-hover:opacity-100"
                        aria-label="Supprimer le repère"
                        title="Supprimer"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ) : (
                  <li key={a.id}>
                    <div
                      className="group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer"
                      style={{ background: a.resultat === "attente" ? "rgba(245,158,11,0.08)" : "transparent" }}
                      onClick={() => allerA(a.t - 2)}
                      title="Revoir ce moment"
                    >
                      <span className="text-xs w-12 shrink-0" style={{ color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{fmtTemps(a.t - debut)}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm truncate" style={{ color: "var(--text-main)" }}>
                          {LIBELLES[a.type]} <span style={{ color: "var(--text-sub)" }}>{detailAction(a)}</span>
                        </span>
                        <span className="block text-xs truncate" style={{ color: a.equipe === "adversaire" ? "var(--text-muted)" : "var(--text-sub)" }}>{nomDe(a)}</span>
                      </span>
                      {estTir(a) && a.resultat === "attente" && (
                        <span className="flex gap-1 shrink-0">
                          <button onClick={(e) => { e.stopPropagation(); trancher(a, "reussi"); }} className="w-7 h-7 rounded-md text-xs" style={{ background: "#16a34a", color: "white" }} aria-label="Rentré">✓</button>
                          <button onClick={(e) => { e.stopPropagation(); trancher(a, "rate"); }} className="w-7 h-7 rounded-md text-xs" style={{ background: "#b91c1c", color: "white" }} aria-label="Raté">✗</button>
                        </span>
                      )}
                      {estTir(a) && a.resultat !== "attente" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); trancher(a, a.resultat === "reussi" ? "rate" : "reussi"); }}
                          className="text-xs px-2 py-0.5 rounded-full shrink-0"
                          style={a.resultat === "reussi" ? { background: "rgba(34,197,94,0.15)", color: "#86efac" } : { background: "rgba(239,68,68,0.15)", color: "#fca5a5" }}
                          title="Cliquer pour inverser"
                        >
                          {a.resultat === "reussi" ? "✓ Rentré" : "✗ Raté"}
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); appliquerOp({ crees: [], modifs: [], supprimes: [a] }); }}
                        className="icon-btn icon-btn-danger w-7 h-7 rounded-md text-xs shrink-0 opacity-60 group-hover:opacity-100"
                        aria-label="Supprimer l'action"
                        title="Supprimer"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </aside>
      </div>

      {/* ── Modales ── */}
      {modal?.kind === "menu" && (
        <MenuActions
          sousTitre={`à ${fmtTemps(modal.t - debut)} · ${modal.pos ? "position du clic gardée pour un tir" : calibrage && modeClic === "video" ? "clic hors du terrain : un tir se placera sur le schéma" : "un tir se placera sur le schéma"}`}
          attente={enAttente[0] ? `${enAttente[0].type === "lf" ? "Lancer franc" : `Tir ${enAttente[0].points} pt${enAttente[0].points === 2 ? "s" : ""}`} de ${nomDe(enAttente[0])}` : null}
          onChoisir={choisirAction}
          onAnnuler={() => fermer(true)}
        />
      )}

      {modal?.kind === "tir" && (
        <Modale titre="Tir" sousTitre={`à ${fmtTemps(modal.t - debut)} · le résultat se donne ensuite`} onAnnuler={() => fermer(true)} large={modal.x === null}>
          {modal.x === null && (
            <div className="mb-3">
              <p className="text-xs mb-2" style={{ color: "var(--text-sub)" }}>Clique à l&apos;endroit du tir</p>
              <Terrain
                onClickTerrain={(x, y) => { const c = classerTir(x, y); setModal({ ...modal, x, y, points: c.points, zone: c.zone }); }}
                style={{ maxHeight: "38vh" }}
              />
            </div>
          )}
          {modal.x !== null && (
            <div className="mb-3 flex items-center gap-3">
              <div className="w-28 shrink-0">
                <Terrain onClickTerrain={(x, y) => { const c = classerTir(x, y); setModal({ ...modal, x, y, points: c.points, zone: c.zone }); }}>
                  <circle cx={tx(modal.x)} cy={modal.y ?? 0} r={0.45} fill="var(--accent)" stroke="white" strokeWidth={0.12} />
                </Terrain>
              </div>
              <p className="text-sm" style={{ color: "var(--text-sub)" }}>{zoneLabel(modal.zone)}<br />Clique sur le schéma pour corriger.</p>
            </div>
          )}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs" style={{ color: "var(--text-sub)" }}>Valeur</span>
            {([1, 2] as const).map((p) => (
              <button
                key={p}
                onClick={() => setModal({ ...modal, points: p, zone: zonePourPoints(p, modal.zone) })}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold"
                style={modal.points === p
                  ? { background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }
                  : { background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
              >
                {p} pt{p === 2 ? "s" : ""}
              </button>
            ))}
            {!modal.points && <span className="text-xs" style={{ color: "#fcd34d" }}>Place le tir ou choisis sa valeur</span>}
          </div>
          <ChoixJoueur choix={choix({ adversaire: avecAdversaire })} onChoisir={validerTir} onAnnuler={() => fermer(true)} desactive={!modal.points} />
        </Modale>
      )}

      {modal?.kind === "lf" && (
        <Modale titre="Lancer franc" sousTitre={`à ${fmtTemps(modal.t - debut)} · le résultat se donne ensuite`} onAnnuler={() => fermer(true)}>
          <ChoixJoueur choix={choix({ adversaire: avecAdversaire })} onChoisir={validerLF} onAnnuler={() => fermer(true)} />
        </Modale>
      )}

      {modal?.kind === "rebond" && (() => {
        const deduit = (eq: "nous" | "adversaire") => deduireRebond(actions, modal.t, eq);
        const peutDeduire = deduit("nous") !== null;
        const libelle = (t: "off" | "def" | null) => (t === "off" ? "Rebond offensif" : t === "def" ? "Rebond défensif" : undefined);
        return (
          <Modale
            titre="Rebond"
            sousTitre={peutDeduire ? "Offensif ou défensif déduit du dernier tir raté" : "Pas de tir raté juste avant : précise le type"}
            onAnnuler={() => fermer(true)}
          >
            <div className="flex items-center gap-2 mb-4">
              {(["off", "def"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRebondForce(rebondForce === r ? null : r)}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold"
                  style={rebondForce === r
                    ? { background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }
                    : { background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
                >
                  {r === "off" ? "Offensif" : "Défensif"}
                </button>
              ))}
              {!peutDeduire && !rebondForce && <span className="text-xs" style={{ color: "#fcd34d" }}>Choisis d&apos;abord</span>}
            </div>
            <ChoixJoueur
              choix={choix({
                adversaire: avecAdversaire,
                info: (id) => libelle(rebondForce ?? deduit(id === "adversaire" ? "adversaire" : "nous")),
              })}
              onChoisir={validerRebond}
              onAnnuler={() => fermer(true)}
              desactive={!peutDeduire && !rebondForce}
            />
          </Modale>
        );
      })()}

      {modal?.kind === "repere" && (
        <ModaleRepere
          key={modal.id ?? "nouveau"}
          titreInitial={modal.titre}
          modification={!!modal.id}
          sousTitre={`à ${fmtTemps(modal.t - debut)}`}
          recents={titresRecents}
          onValider={validerRepere}
          onAnnuler={() => (modal.id ? setModal(null) : fermer(true))}
        />
      )}

      {(modal?.kind === "ballon_gagne" || modal?.kind === "ballon_perdu") && (
        <Modale titre={LIBELLES[modal.kind]} sousTitre={`à ${fmtTemps(modal.t - debut)}`} onAnnuler={() => fermer(true)}>
          <ChoixJoueur choix={choix({ adversaire: false })} onChoisir={validerBallon} onAnnuler={() => fermer(true)} />
        </Modale>
      )}
    </div>
  );
}

const ACTIONS_MENU: { kind: "tir" | "lf" | "rebond" | "ballon_gagne" | "ballon_perdu" | "repere"; label: string; touche: string; couleur: string }[] = [
  { kind: "tir", label: "Tir", touche: "T", couleur: "var(--primary-light)" },
  { kind: "lf", label: "Lancer franc", touche: "L", couleur: "var(--primary-light)" },
  { kind: "rebond", label: "Rebond", touche: "B", couleur: "#C49A28" },
  { kind: "repere", label: "Repère", touche: "N", couleur: "var(--text-sub)" },
  { kind: "ballon_gagne", label: "Ballon gagné", touche: "G", couleur: "#22c55e" },
  { kind: "ballon_perdu", label: "Ballon perdu", touche: "P", couleur: "#ef4444" },
];

/** Menu ouvert par un clic sur la vidéo : que s'est-il passé ? */
function MenuActions({
  sousTitre, attente, onChoisir, onAnnuler,
}: {
  sousTitre: string;
  attente: string | null;
  onChoisir: (kind: (typeof ACTIONS_MENU)[number]["kind"] | "reussi" | "rate") => void;
  onAnnuler: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === "Escape") { e.preventDefault(); onAnnuler(); return; }
      if (attente && (k === "r" || k === "m")) { e.preventDefault(); onChoisir(k === "r" ? "reussi" : "rate"); return; }
      const a = ACTIONS_MENU.find((x) => x.touche.toLowerCase() === k);
      // preventDefault : la lettre ne doit pas arriver dans le champ qui s'ouvre ensuite (titre du repère)
      if (a) { e.preventDefault(); onChoisir(a.kind); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [attente, onChoisir, onAnnuler]);

  return (
    <Modale titre="Que se passe-t-il ?" sousTitre={sousTitre} onAnnuler={onAnnuler}>
      {attente && (
        <div className="mb-3 p-3 rounded-xl" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.4)" }}>
          <p className="text-xs mb-2" style={{ color: "#fcd34d" }}>{attente} en attente</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onChoisir("reussi")} className="hover-lift flex items-center justify-between px-3 py-3 rounded-xl text-sm font-semibold" style={{ background: "#16a34a", color: "white" }}>
              <span>✓ Rentré</span><kbd className="text-xs opacity-80" style={{ fontFamily: "inherit" }}>R</kbd>
            </button>
            <button onClick={() => onChoisir("rate")} className="hover-lift flex items-center justify-between px-3 py-3 rounded-xl text-sm font-semibold" style={{ background: "#b91c1c", color: "white" }}>
              <span>✗ Raté</span><kbd className="text-xs opacity-80" style={{ fontFamily: "inherit" }}>M</kbd>
            </button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {ACTIONS_MENU.map((a) => (
          <button
            key={a.kind}
            onClick={() => onChoisir(a.kind)}
            className="hover-lift flex items-center justify-between gap-2 px-4 py-4 rounded-xl text-base font-semibold text-left"
            style={{ background: `color-mix(in srgb, ${a.couleur} 16%, var(--bg-card2))`, border: `1px solid color-mix(in srgb, ${a.couleur} 45%, transparent)`, color: "var(--text-main)" }}
          >
            <span>{a.label}</span>
            <kbd className="text-xs px-1.5 py-0.5 rounded" style={{ border: "1px solid var(--border)", color: "var(--text-sub)", fontFamily: "inherit" }}>{a.touche}</kbd>
          </button>
        ))}
      </div>
    </Modale>
  );
}

function ModaleRepere({
  titreInitial, modification, sousTitre, recents, onValider, onAnnuler,
}: {
  titreInitial: string;
  modification: boolean;
  sousTitre: string;
  recents: string[];
  onValider: (titre: string) => void;
  onAnnuler: () => void;
}) {
  const [titre, setTitre] = useState(titreInitial);
  return (
    <Modale titre={modification ? "Modifier le repère" : "Repère"} sousTitre={sousTitre} onAnnuler={onAnnuler}>
      <form
        onSubmit={(e) => { e.preventDefault(); onValider(titre); }}
        className="space-y-3"
      >
        <label htmlFor="analyse-repere-titre" className="block text-xs" style={{ color: "var(--text-sub)" }}>
          Titre (facultatif) · Entrée pour valider
        </label>
        <input
          id="analyse-repere-titre"
          autoFocus
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onAnnuler(); } }}
          maxLength={120}
          placeholder="ex. Repli défensif à revoir"
          className="w-full rounded-lg px-3 py-2.5 text-sm"
          style={{ background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-main)" }}
        />
        {recents.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {recents.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onValider(r)}
                className="px-2.5 py-1 rounded-lg text-xs font-medium"
                style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)", color: "var(--accent)" }}
                title="Reprendre ce titre"
              >
                {r}
              </button>
            ))}
          </div>
        )}
        <button
          type="submit"
          className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold"
          style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
        >
          {modification ? "Enregistrer" : "Ajouter le repère"}
        </button>
      </form>
    </Modale>
  );
}

function BarreBouton({ children, onClick, actif = false, accent = false, title }: {
  children: React.ReactNode; onClick: () => void; actif?: boolean; accent?: boolean; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors"
      style={accent
        ? { background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }
        : actif
        ? { background: "color-mix(in srgb,var(--accent) 12%,transparent)", border: "1px solid color-mix(in srgb,var(--accent) 35%,transparent)", color: "var(--accent)" }
        : { border: "1px solid var(--border)", color: "var(--text-sub)" }}
    >
      {children}
    </button>
  );
}

function PanneauCalibrage({
  points, actif, onActif, erreurCm, valide, onEffacer, onRetirer, onAnnuler, onEnregistrer,
}: {
  points: PointCalibrage[];
  actif: string;
  onActif: (id: string) => void;
  erreurCm: number | null;
  valide: boolean;
  onEffacer: () => void;
  onRetirer: (id: string) => void;
  onAnnuler: () => void;
  onEnregistrer: () => void;
}) {
  const place = (id: string) => points.some((p) => p.id === id);
  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="p-4 space-y-3 overflow-y-auto flex-1 min-h-0">
        <p className="font-display text-2xl leading-none" style={{ color: "var(--text-main)" }}>Calibrer le terrain</p>
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-sub)" }}>
          Mets la vidéo sur une image où les lignes se voient bien. Choisis un repère, puis clique dessus dans la vidéo.
          Il en faut 4 au minimum, 6 c&apos;est mieux. Les lignes dorées doivent ensuite tomber sur celles du terrain.
          « Gauche » et « droite » se lisent face au panier, depuis le milieu du terrain.
        </p>
        <Terrain>
          {REPERES.map((r, i) => (
            <g key={r.id} onClick={() => onActif(r.id)} style={{ cursor: "pointer" }}>
              <circle cx={tx(r.x)} cy={r.y} r={0.42} fill={r.id === actif ? "#C49A28" : place(r.id) ? "#22c55e" : "var(--bg-card2)"} stroke="var(--text-main)" strokeWidth={0.06} />
              <text x={tx(r.x)} y={r.y + 0.17} textAnchor="middle" fontSize={0.5} fontWeight={700} fill={r.id === actif || place(r.id) ? "#07090E" : "var(--text-main)"}>{i + 1}</text>
            </g>
          ))}
        </Terrain>
        <ol className="space-y-1">
          {REPERES.map((r, i) => (
            <li key={r.id}>
              <div
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm cursor-pointer"
                style={{ background: r.id === actif ? "color-mix(in srgb,var(--accent) 14%,transparent)" : "transparent", color: "var(--text-main)" }}
                onClick={() => onActif(r.id)}
              >
                <span className="w-5 text-xs text-center" style={{ color: "var(--text-sub)" }}>{i + 1}</span>
                <span className="flex-1 min-w-0 truncate">{r.label}</span>
                {place(r.id) ? (
                  <button onClick={(e) => { e.stopPropagation(); onRetirer(r.id); }} className="text-xs" style={{ color: "#86efac" }} title="Retirer ce repère">✓ placé</button>
                ) : r.id === actif ? (
                  <span className="text-xs" style={{ color: "var(--accent)" }}>à cliquer</span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="p-3 space-y-2" style={{ borderTop: "1px solid var(--border)" }}>
        <p className="text-xs" style={{ color: valide ? "var(--text-sub)" : "#fcd34d" }}>
          {valide
            ? `${points.length} repères · écart moyen ${erreurCm} cm${(erreurCm ?? 0) > 40 ? " (un repère est sans doute mal placé)" : ""}`
            : points.length >= 4
            ? "Repères alignés : choisis-en qui ne sont pas sur une même ligne."
            : `${points.length}/4 repères placés`}
        </p>
        <div className="flex gap-2">
          <button onClick={onAnnuler} className="hover-text-main flex-1 px-3 py-2 rounded-lg text-sm" style={{ border: "1px solid var(--border)", color: "var(--text-sub)" }}>Annuler</button>
          <button onClick={onEffacer} className="hover-text-main px-3 py-2 rounded-lg text-sm" style={{ border: "1px solid var(--border)", color: "var(--text-sub)" }}>Effacer</button>
          <button
            onClick={onEnregistrer}
            disabled={!valide}
            className="flex-1 px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
            style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", color: "white" }}
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
