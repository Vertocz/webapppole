// Le décor (gradins, sol, panneau) est dessiné une fois puis réutilisé à chaque image.
// Ce compteur augmente quand une police ou un logo finit de charger : le décor est alors redessiné.

let version = 0;

export const assetsVersion = () => version;

export function assetsChanged() {
  version++;
}

/** Police de toute l'app : Inconsolata, embarquée (marche hors ligne et dans l'app Android). */
export const FONT = "Inconsolata, ui-monospace, Menlo, Consolas, monospace";
