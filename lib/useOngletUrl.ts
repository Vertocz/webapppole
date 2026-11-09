"use client";

// lib/useOngletUrl.ts
// ─── Onglet actif synchronisé avec l'URL (?onglet=…) ─────────────────────────
// Sans ça, changer d'onglet ne laissait aucune trace dans l'historique : le
// bouton retour quittait la page entière (et renvoyait sur la connexion).
//
// Comportement voulu (comme la plupart des apps mobiles) :
//   • depuis l'onglet d'accueil, ouvrir un onglet → nouvelle entrée d'historique ;
//   • passer d'un onglet à un autre (hors accueil) → on remplace l'entrée, pour
//     ne pas empiler 10 « retour » après 10 clics ;
//   • retour depuis n'importe quel onglet → onglet d'accueil ;
//   • retour depuis l'accueil → sortie de l'app / page précédente.
// L'onglet d'accueil n'apparaît pas dans l'URL.

import { useCallback, useEffect, useRef, useState } from "react";

const CLE = "onglet";

function lireOnglet(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(CLE);
}

function urlAvec(onglet: string | null): string {
  const url = new URL(window.location.href);
  if (onglet) url.searchParams.set(CLE, onglet);
  else url.searchParams.delete(CLE);
  return url.pathname + url.search + url.hash;
}

/**
 * @param accueil onglet affiché quand l'URL n'en précise aucun (peut changer
 *                après chargement, ex. « Mes billets » s'il y a un déplacement).
 * @returns [onglet actif, fonction pour changer d'onglet]
 */
export function useOngletUrl(accueil: string): [string, (onglet: string) => void] {
  const [ongletUrl, setOngletUrl] = useState<string | null>(null);
  // Vrai si l'entrée d'historique courante a été ajoutée par nous depuis
  // l'accueil : revenir à l'accueil = simple « retour » (historique propre).
  const empile = useRef(false);

  useEffect(() => {
    setOngletUrl(lireOnglet());
    const onPop = () => {
      const o = lireOnglet();
      empile.current = false;
      setOngletUrl(o);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const actif = ongletUrl ?? accueil;

  const changer = useCallback(
    (onglet: string) => {
      if (onglet === actif) return;
      const versAccueil = onglet === accueil;

      if (versAccueil) {
        if (empile.current) {
          empile.current = false;
          window.history.back(); // le popstate remettra l'état à jour
          return;
        }
        window.history.replaceState(null, "", urlAvec(null));
      } else if (ongletUrl === null) {
        window.history.pushState(null, "", urlAvec(onglet));
        empile.current = true;
      } else {
        window.history.replaceState(null, "", urlAvec(onglet));
      }
      setOngletUrl(versAccueil ? null : onglet);
    },
    [actif, accueil, ongletUrl],
  );

  return [actif, changer];
}
