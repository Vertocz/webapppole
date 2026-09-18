"""
process_cartes.py — Association des cartes avantage SNCF aux joueurs/staff
─────────────────────────────────────────────────────────────────────────────
Scanne le bucket "cartes", identifie le titulaire de chaque PDF par
correspondance de nom (+ date de naissance si disponible pour départager),
renomme le fichier et l'associe en base pour affichage direct dans l'app
(onglet "Ma carte").

Réutilise la même logique d'extraction/correspondance que process_tickets.py,
sans le parsing de trajets (une carte n'a pas de segments à extraire).

USAGE :
  Lancer manuellement, ou via GitHub Actions (workflow_dispatch).

  Variables d'environnement requises :
    NEXT_PUBLIC_SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import os, io, re
import unidecode
from pypdf import PdfReader
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions
from rapidfuzz import fuzz, process as fuzz_process

# ─── Configuration ─────────────────────────────────────────────────────────────
URL    = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
KEY    = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
BUCKET = "cartes"

if not URL or not KEY:
    raise EnvironmentError("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.")

supabase: Client = create_client(
    URL, KEY,
    options=ClientOptions(auto_refresh_token=False, persist_session=False)
)
supabase.postgrest.auth(KEY)


# ─── Helpers texte (identiques à process_tickets.py) ──────────────────────────
def normalize(text: str) -> str:
    if not text: return ""
    return unidecode.unidecode(text).upper().strip()

def slugify(text: str) -> str:
    if not text: return "INCONNU"
    return re.sub(r'[^A-Z0-9]+', '-', normalize(text)).strip('-')


def extract_name_candidates(full_text: str) -> list[str]:
    candidates = []

    nom_m = re.search(r'Nom\s*:\s*([A-ZÀ-Ÿa-zà-ÿ\-]+)', full_text)
    pre_m = re.search(r'Pr[ée]nom\s*:\s*([A-ZÀ-Ÿa-zà-ÿ\-]+)', full_text)
    if nom_m and pre_m:
        nom = nom_m.group(1).split('Voyageur')[0].strip()
        pre = pre_m.group(1).split('Voyageur')[0].strip()
        candidates += [f"{pre} {nom}", f"{nom} {pre}"]

    # Fallback : ligne "PRENOM NOM - AAAA" (date de validité ou de naissance à côté)
    for m in re.finditer(r'^([A-ZÀ-Ÿ][A-ZÀ-Ÿa-zà-ÿ\s\-]+?)\s*-\s*(?:19|20)\d{2}', full_text, re.M):
        parts = m.group(1).strip().split()
        if len(parts) >= 2:
            candidates += [
                f"{parts[0]} {' '.join(parts[1:])}",
                f"{' '.join(parts[1:])} {parts[0]}",
            ]

    return candidates


def extract_birth_date(text: str) -> str | None:
    m = re.search(r'\b(\d{2})/(\d{2})/((?:19|20)\d{2})\b', text)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return None


def extract_type_carte(text: str) -> str | None:
    m = re.search(r'(Carte Avantage[^\n]*)', text)
    return m.group(1).strip() if m else None


def extract_validity_periods(text: str) -> list[dict]:
    """Extrait toutes les périodes 'Du DD/MM/YYYY au DD/MM/YYYY' trouvées.
    Une carte renouvelée à l'avance peut avoir plusieurs périodes (la
    période en cours + celle déjà achetée pour l'année suivante)."""
    periods = []
    for m in re.finditer(
        r'Du\s+(\d{2})/(\d{2})/(\d{4})\s+au\s+(\d{2})/(\d{2})/(\d{4})', text
    ):
        d1, m1, y1, d2, m2, y2 = m.groups()
        periods.append({"debut": f"{y1}-{m1}-{d1}", "fin": f"{y2}-{m2}-{d2}"})
    periods.sort(key=lambda p: p["debut"])
    return periods


# ─── Matching joueur/staff (identique à process_tickets.py) ───────────────────
def find_person(
    candidates: list[str],
    birth_date: str | None,
    joueuses: list[dict],
    staff: list[dict],
):
    all_persons = [
        (j['id'], j['prenom'], j['nom'], j.get('date_naissance'), "joueuse")
        for j in joueuses
    ] + [
        (s['id'], s['prenom'], s['nom'], s.get('date_naissance'), "staff")
        for s in staff
    ]
    if not all_persons:
        return None

    choices = {normalize(f"{p[1]} {p[2]}"): p for p in all_persons}

    scored = []
    for cand in candidates:
        results = fuzz_process.extract(normalize(cand), choices.keys(), scorer=fuzz.ratio, limit=3)
        for name, score, _ in results:
            if score >= 85:
                scored.append((score, choices[name]))

    if not scored:
        return None
    if len(scored) == 1:
        _, p = scored[0]
        return p[0], p[1], p[2], p[4]

    if birth_date:
        for score, p in sorted(scored, reverse=True):
            if p[3] and p[3] == birth_date:
                return p[0], p[1], p[2], p[4]

    scored.sort(key=lambda x: x[0], reverse=True)
    _, best = scored[0]
    return best[0], best[1], best[2], best[4]


# ─── Pipeline principal ────────────────────────────────────────────────────────
def process_all():
    print("📋 Récupération des joueurs et du staff...")
    try:
        joueuses = supabase.table("joueuses").select("id, prenom, nom, date_naissance").execute().data
    except Exception:
        joueuses = supabase.table("joueuses").select("id, prenom, nom").execute().data
    try:
        staff = supabase.table("staff").select("id, prenom, nom, date_naissance").execute().data
    except Exception:
        staff = supabase.table("staff").select("id, prenom, nom").execute().data

    print(f"📂 Scan du bucket « {BUCKET} »...")
    files = supabase.storage.from_(BUCKET).list()

    unidentified: list[dict] = []
    updated: list[str] = []
    linked: list[str] = []

    for f in files:
        name = f['name']
        if not name.lower().endswith('.pdf'):
            continue

        print(f"\n──────────────────────────────")
        print(f"📄 Traitement : {name}")

        try:
            raw_data = supabase.storage.from_(BUCKET).download(name)
            reader   = PdfReader(io.BytesIO(raw_data))
            full_text = "\n".join(page.extract_text() or "" for page in reader.pages)

            candidates = extract_name_candidates(full_text)
            birth_date = extract_birth_date(full_text)
            match      = find_person(candidates, birth_date, joueuses, staff)

            if not match:
                print(f"⚠️  Titulaire introuvable | candidats extraits : {candidates}")
                unidentified.append({
                    "fichier":    name,
                    "candidats":  candidates,
                    "texte_brut": full_text[:600],
                })
                continue

            person_id, prenom, nom, person_type = match
            print(f"👤 {person_type.capitalize()} identifié·e : {prenom} {nom} (id={person_id})")

            type_carte = extract_type_carte(full_text)
            periods = extract_validity_periods(full_text)
            date_expiration = max((p["fin"] for p in periods), default=None)
            if periods:
                print(f"📅 {len(periods)} période(s) de validité, expire le {date_expiration}")
            else:
                print("⚠️  Aucune période de validité détectée dans le texte extrait.")

            new_name = f"{slugify(nom)}_{slugify(prenom)}.pdf"

            # Renommage avec écrasement : une carte renouvelée peut retomber
            # sur le même nom de fichier cible que la précédente version.
            if name != new_name:
                supabase.storage.from_(BUCKET).upload(
                    new_name, raw_data,
                    {"upsert": "true", "content-type": "application/pdf"},
                )
                supabase.storage.from_(BUCKET).remove([name])
                print(f"📁 Renommé : {name} → {new_name}")

            payload = {
                "nom_fichier":       new_name,
                "url_stockage":      new_name,
                "joueuse_id":        person_id,
                "personne_type":     person_type,
                "type_carte":        type_carte,
                "periodes_validite": periods,
                "date_expiration":   date_expiration,
            }

            existing = supabase.table("cartes").select("id").eq("joueuse_id", person_id).execute()
            if existing.data:
                supabase.table("cartes").update(payload).eq("id", existing.data[0]["id"]).execute()
                print("🔄 Carte existante mise à jour (dates de validité actualisées).")
                updated.append(new_name)
            else:
                supabase.table("cartes").insert(payload).execute()
                print("✅ Carte associée.")
                linked.append(new_name)

        except Exception as e:
            print(f"❌ Erreur critique sur {name} : {e}")
            import traceback; traceback.print_exc()

    print("\n\n══════════════════════════════════════════")
    print(f"✅ {len(linked)} carte(s) nouvellement associée(s).")
    print(f"🔄 {len(updated)} carte(s) mise(s) à jour (dates actualisées).")
    if unidentified:
        print(f"\n⚠️  {len(unidentified)} carte(s) non identifiée(s) :\n")
        for item in unidentified:
            print(f"  Fichier   : {item['fichier']}")
            print(f"  Candidats : {item['candidats'] or '(aucun)'}")
            print(f"  ── Texte extrait (600 premiers caractères) ──")
            for line in item['texte_brut'].splitlines():
                if line.strip():
                    print(f"  │ {line}")
            print()
        print("→ Renomme ces fichiers manuellement (Prénom Nom) ou vérifie l'extraction.")
    print("══════════════════════════════════════════")


if __name__ == "__main__":
    process_all()
