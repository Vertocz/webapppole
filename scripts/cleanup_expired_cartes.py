"""
cleanup_expired_cartes.py
──────────────────────────
Nettoie les cartes avantage SNCF expirées depuis plus de RETENTION_DAYS
jours : alerte d'abord l'admin par notification push, puis supprime la
ligne en base et le fichier PDF associé dans le storage Supabase.

RÈGLE DE CONSERVATION :
  Une carte est conservée tant que sa date d'expiration n'est pas dépassée
  depuis plus de RETENTION_DAYS jours — le délai de grâce laisse le temps
  de renouveler avant suppression définitive.

USAGE :
  Lancer manuellement ou via GitHub Actions (cron hebdomadaire).

  Variables d'environnement requises :
    NEXT_PUBLIC_SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY

  Optionnelles :
    RETENTION_DAYS   (def: 60)   — délai de grâce après expiration
    APP_BASE_URL     (def: https://polefrance.vercel.app) — pour l'alerte push
    ADMIN_PHONE      (def: 0630358954) — numéro du membre du staff à alerter

  Mode simulation (dry-run, rien n'est supprimé ni notifié) :
    DRY_RUN=true python cleanup_expired_cartes.py
"""

import os
import requests
from datetime import date, timedelta
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions

# ─── Configuration ─────────────────────────────────────────────────────────────
URL    = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
KEY    = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
BUCKET = "cartes"

RETENTION_DAYS = int(os.getenv("RETENTION_DAYS", "60"))
APP_BASE_URL   = os.getenv("APP_BASE_URL", "https://polefrance.vercel.app")
ADMIN_PHONE    = os.getenv("ADMIN_PHONE", "0630358954")

DRY_RUN = os.getenv("DRY_RUN", "false").lower() == "true"

if not URL or not KEY:
    raise EnvironmentError("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.")

supabase: Client = create_client(
    URL, KEY,
    options=ClientOptions(auto_refresh_token=False, persist_session=False)
)
supabase.postgrest.auth(KEY)


# ─── Alerte admin ──────────────────────────────────────────────────────────────
def find_admin_staff_id() -> str | None:
    res = supabase.table("staff").select("id, prenom, nom").eq("numero_tel", ADMIN_PHONE).execute()
    if res.data:
        admin = res.data[0]
        print(f"👤 Admin à alerter : {admin['prenom']} {admin['nom']} ({ADMIN_PHONE})")
        return admin["id"]
    return None


def send_push_alert(staff_id: str, title: str, body: str) -> bool:
    try:
        resp = requests.post(
            f"{APP_BASE_URL}/api/push/send",
            json={"staff_id": staff_id, "title": title, "body": body, "target_users": [staff_id]},
            timeout=15,
        )
        if resp.status_code == 200:
            print("🔔 Alerte envoyée à l'admin.")
            return True
        print(f"⚠️  Échec de l'envoi de l'alerte (HTTP {resp.status_code}) : {resp.text[:200]}")
        return False
    except Exception as e:
        print(f"⚠️  Erreur réseau lors de l'envoi de l'alerte : {e}")
        return False


# ─── Logique principale ────────────────────────────────────────────────────────
def cleanup():
    today     = date.today()
    seuil     = today - timedelta(days=RETENTION_DAYS)
    seuil_str = seuil.isoformat()

    mode = "🔍 DRY-RUN" if DRY_RUN else "🗑️  SUPPRESSION"
    print(f"{mode} — Cartes expirées depuis plus de {RETENTION_DAYS} jours (avant le {seuil_str})\n")

    res = (
        supabase.table("cartes")
        .select("id, nom_fichier, url_stockage, date_expiration, joueuse_id, personne_type")
        .not_.is_("date_expiration", "null")
        .lte("date_expiration", seuil_str)
        .execute()
    )
    expired = res.data or []

    print(f"📦 {len(expired)} carte(s) concernée(s).\n")

    if not expired:
        print("✅ Rien à nettoyer.")
        return

    # Résolution des noms pour un message d'alerte lisible
    ids_joueuses = [c["joueuse_id"] for c in expired if c["personne_type"] == "joueuse"]
    ids_staff    = [c["joueuse_id"] for c in expired if c["personne_type"] == "staff"]
    names: dict[str, str] = {}
    if ids_joueuses:
        for p in (supabase.table("joueuses").select("id, prenom, nom").in_("id", ids_joueuses).execute().data or []):
            names[p["id"]] = f"{p['prenom']} {p['nom']}"
    if ids_staff:
        for p in (supabase.table("staff").select("id, prenom, nom").in_("id", ids_staff).execute().data or []):
            names[p["id"]] = f"{p['prenom']} {p['nom']}"

    for c in expired:
        who = names.get(c["joueuse_id"], "Personne inconnue")
        print(f"  🗑️  {who} — expirée le {c['date_expiration']} | {c['nom_fichier']}")

    # ── Alerte admin, TOUJOURS avant suppression ────────────────────────────
    admin_id = find_admin_staff_id()
    liste = "\n".join(f"• {names.get(c['joueuse_id'], '?')} (expirée le {c['date_expiration']})" for c in expired)
    body = f"{len(expired)} carte(s) avantage vont être supprimées (expirées depuis plus de {RETENTION_DAYS} jours) :\n{liste}"

    if not admin_id:
        print(f"⚠️  Aucun membre du staff trouvé avec le numéro {ADMIN_PHONE} — alerte non envoyée.")
    elif DRY_RUN:
        print(f"\n📣 [DRY-RUN] Alerte qui serait envoyée à l'admin :\n{body}\n")
    else:
        send_push_alert(admin_id, "💳 Cartes avantage expirées", body)

    if DRY_RUN:
        print("\n⚠️  Mode DRY-RUN : aucune suppression effectuée.")
        print("    Relancez sans DRY_RUN=true pour appliquer.\n")
        return

    # ── Suppression effective ───────────────────────────────────────────────
    print("\n🚀 Démarrage de la suppression...\n")
    errors = []

    for c in expired:
        try:
            supabase.table("cartes").delete().eq("id", c["id"]).execute()
            print(f"  🗑️  Ligne supprimée en DB : id={c['id']}")

            storage_res = supabase.storage.from_(BUCKET).remove([c["url_stockage"]])
            if storage_res:
                print(f"  🗑️  Fichier supprimé dans le storage : {c['url_stockage']}")
            else:
                print(f"  ⚠️  Fichier introuvable dans le storage (déjà supprimé ?) : {c['url_stockage']}")

        except Exception as e:
            msg = f"❌ Erreur pour carte id={c['id']} ({c['nom_fichier']}) : {e}"
            print(f"  {msg}")
            errors.append(msg)

    print(f"\n{'═' * 50}")
    if not errors:
        print(f"✅ Nettoyage terminé : {len(expired)} carte(s) supprimée(s).")
    else:
        print(f"⚠️  Nettoyage terminé avec {len(errors)} erreur(s) :")
        for err in errors:
            print(f"  {err}")


if __name__ == "__main__":
    cleanup()
