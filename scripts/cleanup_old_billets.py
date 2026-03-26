"""
cleanup_old_billets.py
──────────────────────
Nettoie les billets de train et leurs fichiers PDF dans le storage Supabase
quand TOUS les trajets associés à un billet sont passés depuis plus d'une semaine.

RÈGLE DE CONSERVATION :
  Un billet est conservé si l'UN de ces critères est vrai :
    1. Il contient au moins un trajet dont la date_depart >= (aujourd'hui - 7 jours)
    2. Il contient des trajets sur des dates très espacées (aller + retour sur le même
       PDF, avec plus d'une semaine d'écart entre le premier et le dernier trajet) —
       dans ce cas le PDF est conservé tant que le trajet le plus récent n'est pas
       lui-même passé depuis plus d'une semaine.

  En pratique, la règle 2 est couverte par la règle 1 : si le retour est dans le futur
  (ou passé depuis moins d'une semaine), le billet est conservé.

USAGE :
  Lancer manuellement ou via GitHub Actions (cron hebdomadaire).

  Variables d'environnement requises :
    NEXT_PUBLIC_SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY

  Mode simulation (dry-run, rien n'est supprimé) :
    DRY_RUN=true python cleanup_old_billets.py
"""

import os
from datetime import date, timedelta
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions

# ─── Configuration ─────────────────────────────────────────────────────────────

URL    = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
KEY    = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
BUCKET = "Billets"

# Un billet est supprimé si son trajet le plus récent est passé depuis > N jours.
RETENTION_DAYS = 7

# DRY_RUN=true → affiche ce qui serait supprimé sans rien faire
DRY_RUN = os.getenv("DRY_RUN", "false").lower() == "true"

if not URL or not KEY:
    raise EnvironmentError("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.")

supabase: Client = create_client(
    URL, KEY,
    options=ClientOptions(auto_refresh_token=False, persist_session=False)
)
supabase.postgrest.auth(KEY)


# ─── Logique principale ────────────────────────────────────────────────────────

def cleanup():
    today      = date.today()
    seuil      = today - timedelta(days=RETENTION_DAYS)
    seuil_str  = seuil.isoformat()

    mode = "🔍 DRY-RUN" if DRY_RUN else "🗑️  SUPPRESSION"
    print(f"{mode} — Nettoyage des billets dont tous les trajets sont antérieurs à {seuil_str}\n")

    # 1. Récupérer tous les billets avec leurs trajets
    res = supabase.table("billets").select("id, nom_fichier, url_stockage, trajets(id, date_depart)").execute()
    billets = res.data or []

    print(f"📦 {len(billets)} billet(s) trouvé(s) au total.\n")

    to_delete = []

    for billet in billets:
        billet_id    = billet["id"]
        nom_fichier  = billet["nom_fichier"]
        url_stockage = billet["url_stockage"]
        trajets      = billet.get("trajets") or []

        if not trajets:
            # Billet sans trajet parsé (orphelin) — on le conserve pour analyse
            print(f"  ⚠️  Billet id={billet_id} ({nom_fichier}) : aucun trajet → conservé (orphelin)")
            continue

        # Date la plus récente parmi tous les trajets du billet
        # (couvre le cas aller+retour sur le même PDF)
        dates = [t["date_depart"] for t in trajets if t.get("date_depart")]
        if not dates:
            print(f"  ⚠️  Billet id={billet_id} ({nom_fichier}) : dates manquantes → conservé")
            continue

        date_max = max(dates)  # ISO string, tri lexicographique = tri chronologique

        if date_max > seuil_str:
            # Le trajet le plus récent est encore "actif" (dans la fenêtre de rétention)
            print(f"  ✅ Conservé  id={billet_id} | dernier trajet={date_max} | {nom_fichier}")
        else:
            # Tous les trajets sont passés depuis plus d'une semaine
            print(f"  🗑️  À supprimer id={billet_id} | dernier trajet={date_max} | {nom_fichier}")
            to_delete.append({
                "id":           billet_id,
                "nom_fichier":  nom_fichier,
                "url_stockage": url_stockage,
                "trajets_ids":  [t["id"] for t in trajets],
                "date_max":     date_max,
            })

    print(f"\n{'─' * 50}")
    print(f"  → {len(to_delete)} billet(s) à supprimer sur {len(billets)} au total.")

    if not to_delete:
        print("\n✅ Rien à nettoyer.")
        return

    if DRY_RUN:
        print("\n⚠️  Mode DRY-RUN : aucune suppression effectuée.")
        print("    Relancez sans DRY_RUN=true pour appliquer.\n")
        return

    # 2. Suppression effective
    print("\n🚀 Démarrage de la suppression...\n")

    errors = []

    for item in to_delete:
        billet_id    = item["id"]
        url_stockage = item["url_stockage"]
        trajets_ids  = item["trajets_ids"]

        try:
            # 2a. Supprimer les trajets liés (enfants)
            if trajets_ids:
                supabase.table("trajets").delete().in_("id", trajets_ids).execute()
                print(f"  🗑️  Trajets supprimés : {len(trajets_ids)} entrée(s) pour billet id={billet_id}")

            # 2b. Supprimer le billet en base
            supabase.table("billets").delete().eq("id", billet_id).execute()
            print(f"  🗑️  Billet supprimé en DB : id={billet_id}")

            # 2c. Supprimer le PDF dans le storage
            # url_stockage contient le chemin dans le bucket (ex: "PNR_NOM_PRENOM.pdf")
            storage_res = supabase.storage.from_(BUCKET).remove([url_stockage])
            if storage_res:
                print(f"  🗑️  Fichier supprimé dans le storage : {url_stockage}")
            else:
                print(f"  ⚠️  Fichier introuvable dans le storage (déjà supprimé ?) : {url_stockage}")

        except Exception as e:
            msg = f"❌ Erreur pour billet id={billet_id} ({item['nom_fichier']}) : {e}"
            print(f"  {msg}")
            errors.append(msg)

    print(f"\n{'═' * 50}")
    if not errors:
        print(f"✅ Nettoyage terminé : {len(to_delete)} billet(s) supprimé(s).")
    else:
        print(f"⚠️  Nettoyage terminé avec {len(errors)} erreur(s) :")
        for err in errors:
            print(f"  {err}")


if __name__ == "__main__":
    cleanup()
