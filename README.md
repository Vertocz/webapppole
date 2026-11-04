# ParaBasket Pôle — Pôle France Para Basketball Adapté

Application web (PWA) des Pôles France masculin et féminin : billets de train,
suivi sportif et de forme, préparation mentale, badges, cartes Victorinis,
jeux, notifications push et outils staff.

Next.js 15 (App Router) · React 18 · TypeScript · Tailwind CSS 4 · Supabase · déployée sur Vercel.

## Lancer le projet

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # build de production
```

Variables d'environnement (Vercel ou `.env.local`) :

| Variable | Usage |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Routes API serveur (push, rappels, Victorinis) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Notifications push |
| `CRON_SECRET` / `INTERNAL_CRON_KEY` | Rappels hebdomadaires (cron Vercel) |
| `SNCF_API_KEY` | Recherche de trajets (page trains) |
| `NEXT_PUBLIC_GITHUB_REPO` / `NEXT_PUBLIC_GITHUB_TOKEN` | Déclenchement du traitement des billets/cartes |
| `NEXT_PUBLIC_APP_URL` | URL publique de l'app |

Le client Supabase du navigateur (`lib/supabase.ts`) contient l'URL et la clé `anon`.

## Structure

```
app/
  page.tsx              Connexion par numéro de téléphone (06/07)
  player/page.tsx       Espace joueur·se
  staff/page.tsx        Espace staff (+ staff/admin, trains)
  api/                  Push, notifications, rappels (cron), SNCF, Victorinis
components/             Onglets et modales (Billets, SuiviSportif, SuiviForme,
                        mentale/, games/, Victorinis, badges…)
lib/
  supabase.ts           Client Supabase + cache de lecture hors ligne
  offline.ts            Mode hors ligne : cache, file d'attente, billets PDF
  session.ts            Session persistante (localStorage)
  dates.ts              Dates locales "YYYY-MM-DD"
public/sw.js            Service worker (cache, hors ligne, push)
scripts/ + .github/     Traitement automatique des billets et cartes (GitHub Actions)
sql/, supabase/         Scripts SQL (Victorinis, quiz)
```

## Analyse vidéo (staff du pôle masculin)

Onglet « Analyse vidéo » de l'espace staff (`components/analyse/`, logique dans `lib/analyse.ts`).
À la première mise en place, exécuter `sql/analyse_video.sql` dans Supabase > SQL Editor.

- Le coach crée le match (date, adversaire, 4 joueurs, suivi de l'adversaire) puis ouvre la vidéo
  depuis son PC : elle est lue localement, jamais envoyée.
- Clic sur les pieds du tireur au déclenchement du tir → pause → choix du joueur → la vidéo repart.
  Le résultat (rentré / raté) se donne ensuite, et un rebond tagué passe le tir en attente en raté.
- Position du tir : calibrage du terrain (4 repères minimum) ou terrain dessiné.
- Raccourcis : Espace, ← →, T tir, L lancer franc, B rebond, G/P ballon gagné/perdu, R/M résultat,
  1-4 joueur, 0 adversaire, Ctrl+Z annuler.
- Stats du match, carte des tirs par zone, export PDF et évolution sur plusieurs matchs.

## Mode hors ligne

Une fois l'app ouverte au moins une fois avec du réseau :

- **Session persistante** : plus besoin de se reconnecter à chaque ouverture.
- **Consultation** : chaque lecture Supabase est gardée dans IndexedDB et
  resservie sans réseau, ou si le réseau met plus de 6 s à répondre.
- **Billets** : les PDF des trajets à venir sont téléchargés à l'ouverture de
  l'app et s'ouvrent sans réseau (visionneuse intégrée + partage/enregistrement).
- **Saisies** (suivi sportif, forme, émotions, respiration, scores du quiz) :
  enregistrées sur l'appareil puis envoyées automatiquement au retour du réseau.
  Les cartes Victorinis et badges sont attribués au moment de l'envoi.
- **Jeux** : fonctionnaient déjà sans internet (WebRTC + QR codes) ; les
  questions du quiz sont désormais gardées en cache.
- Un bandeau en bas de l'écran indique l'état (hors ligne, envoi en cours, erreurs).

Le service worker est enregistré avec la version du commit (`/sw.js?v=…`) :
chaque déploiement met à jour le cache automatiquement, rien à changer à la main.

La connexion initiale nécessite le réseau.
