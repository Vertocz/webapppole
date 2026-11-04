// Stickers des sponsors. Tout se règle dans public/sponsors.json, sans toucher au code :
// on dépose le logo dans public/sponsors/ et on ajoute une ligne (voir public/sponsors.json).
//
// Emplacements :
//   "planche-gauche" / "planche-droite" : petits stickers en haut de la planche
//   "mur"                               : panneau lumineux derrière la ligne de fond
// (le sol est réservé au logo SWISH3X3)
//
// Ajoute ?demo à l'adresse du jeu pour afficher « VOTRE LOGO ICI » sur les emplacements libres :
// pratique pour montrer le jeu à un sponsor potentiel.

import { assetsChanged } from "./assets";

export type SponsorSlot = "planche-gauche" | "planche-droite" | "mur";

export interface Sponsor {
  name: string;
  image?: string; // chemin dans public/, ex. "sponsors/boulangerie.png" (PNG transparent conseillé)
  slot: SponsorSlot;
  url?: string; // site du sponsor, affiché sur l'écran d'accueil
}

interface Loaded extends Sponsor {
  img: HTMLImageElement | null;
}

export const SLOTS: SponsorSlot[] = ["planche-gauche", "planche-droite", "mur"];
export const PLACEHOLDER = "VOTRE LOGO ICI";

let loaded: Loaded[] = [];
let demo = false;

export async function loadSponsors(): Promise<Sponsor[]> {
  demo = new URLSearchParams(location.search).has("demo");
  try {
    const res = await fetch("/sponsors.json", { cache: "no-cache" });
    const data = (await res.json()) as { sponsors?: Sponsor[] };
    const list = (data.sponsors ?? []).filter((s) => SLOTS.includes(s.slot));
    loaded = list.map((s) => ({ ...s, img: null }));
    for (const s of loaded) {
      if (!s.image) continue;
      const img = new Image();
      img.onload = () => {
        s.img = img;
        assetsChanged();
      };
      img.src = `/${s.image.replace(/^\/+/, "")}`;
    }
    assetsChanged();
    return list;
  } catch {
    loaded = [];
    assetsChanged();
    return [];
  }
}

/** Ce qu'il faut dessiner à un emplacement : un logo, un nom, un « VOTRE LOGO ICI », ou rien. */
export function sponsorAt(slot: SponsorSlot): { img: HTMLImageElement | null; label: string } | null {
  const s = loaded.find((x) => x.slot === slot);
  if (s) return { img: s.img, label: s.name };
  return demo ? { img: null, label: PLACEHOLDER } : null;
}
