# Pôle France Para Basketball Adapté — Next.js App

Réécriture complète du site Streamlit en Next.js 14 avec App Router, TypeScript et Tailwind CSS.

## Installation

```bash
npm install
```

## Configuration

Copiez `.env.local.example` en `.env.local` et remplissez vos clés Supabase :

```bash
cp .env.local.example .env.local
```

Editez `.env.local` :
```
NEXT_PUBLIC_SUPABASE_URL=https://fxvotvtapcwzvjhfreqv.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=votre_clé_anon_ici
```

Vous trouverez la clé `anon` dans votre dashboard Supabase → Settings → API.

## Lancement en développement

```bash
npm run dev
```

Ouvrez [http://localhost:3000](http://localhost:3000).

## Build production

```bash
npm run build
npm start
```

## Structure du projet

```
parabasket/
├── app/
│   ├── page.tsx          ← Page de connexion (login par numéro de téléphone)
│   ├── joueuse/
│   │   └── page.tsx      ← Espace joueuse (billets, suivi sportif, forme)
│   └── staff/
│       └── page.tsx      ← Espace staff (billets, consultation suivis)
├── components/
│   ├── Layout.tsx         ← Header + navigation par onglets
│   ├── Billets.tsx        ← Affichage des billets de train
│   ├── SuiviSportif.tsx   ← Formulaire + historique activités sportives
│   ├── SuiviForme.tsx     ← Formulaire + historique suivi de forme
│   ├── SliderField.tsx    ← Composant slider réutilisable
│   └── Card.tsx           ← Carte réutilisable
├── lib/
│   └── supabase.ts        ← Client Supabase
└── types/
    └── index.ts           ← Types TypeScript
```

## Fonctionnalités implémentées

- ✅ Authentification par numéro de téléphone (joueuse ou staff)
- ✅ Espace joueuse : billets de train, suivi sportif, suivi de forme quotidienne
- ✅ Espace staff : mes billets + consultation des suivis de toutes les joueuses
- ✅ Filtrage par catégorie (masculin/féminin) selon les droits du staff
- ✅ Suppression des entrées avec confirmation
- ✅ Historique des 30 derniers jours
- ✅ Interface sombre avec thème basketball

## Fonctionnalités non implémentées (pour l'instant)

- 📊 Graphiques (Plotly → à implémenter avec Recharts ou Chart.js)
- 📈 Analyses (charge, variabilité, corrélation difficulté/plaisir)
- 🔄 Actualisation des billets depuis le storage

## Tables Supabase à créer pour la Préparation Mentale

### `suivi_emotions`
```sql
create table suivi_emotions (
  id uuid primary key default gen_random_uuid(),
  joueur_id uuid not null references joueuses(id) on delete cascade,
  date date not null,
  emotion_nom text not null,
  intensite integer not null check (intensite between 1 and 10),
  declencheur text default '',
  ressources text default '',
  created_at timestamptz default now()
);
```

### `suivi_respiration`
```sql
create table suivi_respiration (
  id uuid primary key default gen_random_uuid(),
  joueur_id uuid not null references joueuses(id) on delete cascade,
  date date not null,
  contexte text not null check (contexte in ('quotidien', 'basket')),
  exercice text,
  commentaire text default '',
  created_at timestamptz default now()
);
```

## Buckets Supabase Storage à créer

- **`emotions`** — images .jpg pour chaque émotion (noms : `joie.jpg`, `confiance.jpg`, `peur.jpg`, `colere.jpg`, `tristesse.jpg`, `surprise.jpg`, `degout.jpg`, `anxiete.jpg`)
- **`respiration-audio`** — fichiers .mp3 pour les guides vocaux (noms : `coherence-cardiaque.mp3`, `respiration-boite.mp3`, `activation.mp3`, `recuperation.mp3`, `4-7-8.mp3`)

Pour activer les images dans `EmotionsTab.tsx`, décommenter le bloc `<img>` et commenter le `<span>` emoji.
