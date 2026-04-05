export type UserType = "joueuse" | "staff";

export interface Joueuse {
  id: string;
  prenom: string;
  nom: string;
  numero_tel: string;
  categorie?: string;
}

export interface Staff {
  id: string;
  prenom: string;
  nom: string;
  numero_tel: string;
  masculin?: boolean;
  feminin?: boolean;
}

export interface Billet {
  id: string;
  joueuse_id: string;
  nom_fichier: string;
  url_stockage: string;
  created_at: string;
}

export interface Activite {
  id: string;
  joueuse_id: string;
  sport: string;
  duree: string;
  difficulte: number;
  plaisir: number;
  commentaire?: string;
  date: string;
}

export interface SuiviForme {
  id: string;
  joueuse_id: string;
  date: string;
  fatigue: number;
  sommeil: number;
  douleur: number;
  stress: number;
  humeur: number;
  commentaire?: string;
}

export interface SuiviEmotion {
  id: string;
  joueur_id: string;
  date: string;
  emotion_nom: string;
  intensite: number;
  declencheur: string;
  ressources: string;
  created_at: string;
}

export interface SuiviRespiration {
  id: string;
  joueur_id: string;
  date: string;
  contexte: "activation" | "relaxation" | "scan";
  exercice: string;
  commentaire: string;
  temps?: string;
  moment?: string;
  posture?: string;
  created_at: string;
}