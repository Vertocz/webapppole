"""
process_tickets.py — Traitement des billets SNCF pour Para Basketball
Gère : OUIGO, TGV INOUI, TER, CAR TER
Gère : billets multi-pages (plusieurs trajets), connexions TER sur une même page
"""

import os, io, re
import unidecode
from dotenv import load_dotenv
from pypdf import PdfReader
from supabase import create_client, Client
from rapidfuzz import fuzz, process as fuzz_process

# ─── Configuration ─────────────────────────────────────────────────────────────
load_dotenv(dotenv_path=".env.local")
URL  = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
KEY  = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
BUCKET = "Billets"

supabase: Client = create_client(URL, KEY)

# ─── Helpers texte ─────────────────────────────────────────────────────────────
def normalize(text: str) -> str:
    if not text: return ""
    return unidecode.unidecode(text).upper().strip()

def slugify(text: str) -> str:
    if not text: return "INCONNU"
    return re.sub(r'[^A-Z0-9]+', '-', normalize(text)).strip('-')

# Mots parasites qui peuvent suivre un nom de gare dans le texte brut PDF
NOISE_WORDS = re.compile(
    r'\b(TGV|OUIGO|INOUI|TER|CAR|OPÉRÉ|OPÈRE|VOITURE|PLACE|BILLET|'
    r'GRANDE|VITESSE|SNCF|CLASSE|TARIF|ADULTE|VOYAGEUR|ESSENTIEL)\b',
    re.I
)

def clean_station(raw: str) -> str:
    """Nettoie un nom de gare : retire le bruit, normalise les espaces."""
    s = raw.strip()
    # Retire tout ce qui suit un mot parasite
    s = NOISE_WORDS.sub('|CUT|', s).split('|CUT|')[0].strip()
    s = re.sub(r'\s+', ' ', s)
    return s.upper() if len(s) >= 3 else ""


# ─── Extraction PNR ────────────────────────────────────────────────────────────
# Formats rencontrés :
#   OUIGO   → "Votre numéro de réservation est : A634AT"
#   TGV     → "Dossier voyage : 6MSX9L"
#   TER     → "REF : 4TYTTS"  ou  "N° DV : 4TYTTS"
def extract_pnr(text: str) -> str:
    BLACKLIST = {'SAMEDI', 'EUROPE', 'LUNDI', 'MARDI', 'JEUDI', 'VENDREDI', 'FRANCE'}
    patterns = [
        r'(?:réservation\s+est|Dossier\s+voyage)\s*:\s*([A-Z0-9]{6})\b',
        r'(?:REF|N°\s*DV)\s*[:\s]+([A-Z0-9]{6})\b',
    ]
    for p in patterns:
        m = re.search(p, text, re.I)
        if m:
            val = m.group(1).upper()
            if val not in BLACKLIST:
                return val
    return "000000"


# ─── Extraction date ───────────────────────────────────────────────────────────
MOIS_FR = {
    "janvier": "01", "février": "02", "fevrier": "02",
    "mars": "03", "avril": "04", "mai": "05", "juin": "06",
    "juillet": "07", "août": "08", "aout": "08",
    "septembre": "09", "octobre": "10", "novembre": "11",
    "décembre": "12", "decembre": "12",
}

def extract_date(text: str) -> str:
    """
    Extrait la date de TRAJET.
    Les dates DD/MM/YYYY dans les billets TER sont des dates de naissance,
    pas des dates de voyage — on les ignore ici.
    """
    m = re.search(
        r'(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)?\s*'
        r'(\d{1,2})\s+(' + '|'.join(MOIS_FR) + r')\s+(\d{4})',
        text, re.I
    )
    if m:
        d, mois, y = m.group(1), m.group(2).lower(), m.group(3)
        return f"{y}-{MOIS_FR[mois]}-{d.zfill(2)}"
    return "2026-01-01"


def extract_birth_date(text: str) -> str | None:
    """
    Extrait la date de naissance DD/MM/YYYY des billets TER.
    Retourne "YYYY-MM-DD" ou None.
    """
    m = re.search(r'\b(\d{2})/(\d{2})/((?:19|20)\d{2})\b', text)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return None


# ─── Extraction des noms candidats ────────────────────────────────────────────
def extract_name_candidates(full_text: str) -> list[str]:
    candidates = []

    # TGV INOUI → "Nom : DESOTEUX\nPrénom : Tanguy"
    nom_m = re.search(r'Nom\s*:\s*([A-ZÀ-Ÿa-zà-ÿ\-]+)', full_text)
    pre_m = re.search(r'Prénom\s*:\s*([A-ZÀ-Ÿa-zà-ÿ\-]+)', full_text)
    if nom_m and pre_m:
        nom = nom_m.group(1).split('Voyageur')[0].strip()
        pre = pre_m.group(1).split('Voyageur')[0].strip()
        candidates += [f"{pre} {nom}", f"{nom} {pre}"]

    # OUIGO → "SAFIA HADDADJ - 1977"
    for m in re.finditer(r'^([A-ZÀ-Ÿ][A-ZÀ-Ÿa-zà-ÿ\s\-]+?)\s*-\s*(?:19|20)\d{2}', full_text, re.M):
        parts = m.group(1).strip().split()
        if len(parts) >= 2:
            candidates += [
                f"{parts[0]} {' '.join(parts[1:])}",
                f"{' '.join(parts[1:])} {parts[0]}",
            ]

    # TER → lignes séparées : "CADET\nDONOVAN\n11/03/2000"
    lines = [l.strip() for l in full_text.split('\n') if l.strip()]
    for i, line in enumerate(lines):
        # TER : la date peut être suivie de " REF : XXXXXX" sur la même ligne
        if re.match(r'^\d{2}/\d{2}/\d{4}\b', line) and i >= 2:
            a, b = lines[i-2], lines[i-1]
            # Garde seulement si ce sont bien des noms (pas de chiffres)
            # Autorise les espaces (noms composés ex. "DAVIS GUO") mais rejette les chiffres
            if re.match(r'^[A-ZÀ-Ÿa-zà-ÿ\s\-]+$', a) and re.match(r'^[A-ZÀ-Ÿa-zà-ÿ\s\-]+$', b):
                # Génère les combinaisons : chaque partie de a avec chaque partie de b
                parts_a = a.strip().split()
                parts_b = b.strip().split()
                # Candidats standards
                candidates += [f"{a} {b}", f"{b} {a}"]
                # Si nom composé : aussi première partie seulement (ex. "DAVIS" + "WILLIAM")
                if len(parts_a) > 1:
                    candidates += [f"{parts_a[0]} {b}", f"{b} {parts_a[0]}"]
                if len(parts_b) > 1:
                    candidates += [f"{a} {parts_b[0]}", f"{parts_b[0]} {a}"]

    return candidates


# ─── Extraction des arrêts depuis une page ────────────────────────────────────
def extract_stops_from_page(page_text: str) -> list[tuple[str, str]]:
    """
    Retourne une liste de (heure_HH:MM, nom_gare) dans l'ordre d'apparition.
    Gère les deux formats :
      - Inline  : "10h14 LILLE FLANDRES"  (TGV INOUI, OUIGO)
      - Multiline : "18h15\nLILLE EUROPE"  (TER)
    """
    stops = []

    # Format inline : heure et gare sur la même ligne
    inline_hits = re.findall(
        r'(\d{1,2}h\d{2})\s+([A-ZÀ-Ÿ][A-ZÀ-Ÿa-zà-ÿ\s\-\'1-9]+?)(?=\n|$)',
        page_text
    )
    for raw_time, raw_station in inline_hits:
        station = clean_station(raw_station)
        if station:
            stops.append((raw_time.replace('h', ':'), station))

    # Si aucun stop inline, essaie le format multiline (TER)
    if not stops:
        lines = [l.strip() for l in page_text.split('\n') if l.strip()]
        for i, line in enumerate(lines):
            m = re.match(r'^(\d{1,2})h(\d{2})$', line)
            if m and i + 1 < len(lines):
                time_str = f"{m.group(1).zfill(2)}:{m.group(2)}"
                station = clean_station(lines[i + 1])
                # Sanity : commence par une majuscule, pas un chiffre seul
                if station and re.match(r'^[A-Z]', station):
                    stops.append((time_str, station))

    return stops


# ─── Extraction du type et numéro de train entre deux positions ───────────────
def extract_train_info(chunk: str) -> tuple[str, str]:
    """
    Cherche dans un bloc de texte le type et numéro du train.
    Retourne (type_train, numero_train).
    """
    # TGV INOUI NNNN
    m = re.search(r'TGV\s+INOUI\s+(\d+)', chunk, re.I)
    if m: return "TGV INOUI", m.group(1)

    # INTERCITÉS NNNN
    m = re.search(r'INTERCIT[EÉ]S?\s+(\d+)', chunk, re.I)
    if m: return "INTERCITÉS", m.group(1)

    # OUIGO → "Grande Vitesse train N° 7660"
    m = re.search(r'train\s+N°\s*(\d+)', chunk, re.I)
    if m: return "OUIGO", m.group(1)

    # CAR TER HDF P73 ou CAR TER XXX NNNN
    m = re.search(r'CAR\s+TER\s+\S+\s+(\S+)', chunk, re.I)
    if m: return "CAR TER", m.group(1)

    # TER avec numéro de train seul sur une ligne (4 ou 5 chiffres)
    m = re.search(r'^(\d{4,5})$', chunk, re.M)
    if m: return "TER", m.group(1)

    return "", ""


# ─── Découpage en segments depuis une page ────────────────────────────────────
def parse_segments_from_page(page_text: str) -> list[dict]:
    """
    Extrait 1 ou N segments depuis le texte d'une page.

    Détecte les connexions TER : quand une gare apparaît consécutivement
    comme arrivée puis comme départ (ex. CALAIS-FRÉTHUN → CALAIS-FRÉTHUN).
    """
    stops = extract_stops_from_page(page_text)
    if len(stops) < 2:
        return []

    date = extract_date(page_text)
    lines = page_text.split('\n')
    segments = []

    i = 0
    while i < len(stops) - 1:
        dep_time, dep_station = stops[i]
        arr_time, arr_station = stops[i + 1]

        # Bloc de texte entre les deux gares pour trouver le type de train
        # On cherche dans le texte global entre les deux occurrences de temps
        dep_pos = page_text.find(dep_time.replace(':', 'h'))
        arr_pos = page_text.find(arr_time.replace(':', 'h'), dep_pos + 1)
        chunk = page_text[dep_pos:arr_pos] if arr_pos > dep_pos else page_text[dep_pos:dep_pos + 200]

        train_type, train_num = extract_train_info(chunk)

        segments.append({
            "gare_depart":   dep_station,
            "gare_arrivee":  arr_station,
            "heure_depart":  dep_time,
            "heure_arrivee": arr_time,
            "type_train":    train_type,
            "numero_train":  train_num,
            "date_depart":   date,
        })

        # Connexion TER : l'arrivée est identique au prochain départ → sauter
        if (i + 2 < len(stops) and
                normalize(stops[i + 2][1]) == normalize(arr_station)):
            i += 2   # le prochain départ est déjà la prochaine gare
        else:
            i += 2   # cas standard

    return segments


# ─── Matching joueur ───────────────────────────────────────────────────────────
def find_joueuse(
    candidates: list[str],
    birth_date: str | None,
    joueuses: list[dict],
    staff: list[dict],
) -> tuple | None:
    """
    Retourne (id, prenom, nom, type) de la meilleure correspondance, ou None.

    Stratégie en deux passes :
    1. Fuzzy matching sur le nom (seuil 85) — suffit dans la majorité des cas.
    2. Si plusieurs candidats proches ou nom trop court : départage par date
       de naissance si elle est présente dans le billet ET dans la base.
    """
    all_persons = [
        (j['id'], j['prenom'], j['nom'], j.get('date_naissance'), "joueuse")
        for j in joueuses
    ] + [
        (s['id'], s['prenom'], s['nom'], s.get('date_naissance'), "staff")
        for s in staff
    ]

    if not all_persons:
        return None

    # Passe 1 : fuzzy sur le nom
    choices = {
        normalize(f"{p[1]} {p[2]}"): p
        for p in all_persons
    }

    scored = []
    for cand in candidates:
        results = fuzz_process.extract(normalize(cand), choices.keys(), scorer=fuzz.ratio, limit=3)
        for name, score, _ in results:
            if score >= 85:
                scored.append((score, choices[name]))

    if not scored:
        return None

    # Une seule correspondance nette → retour direct
    if len(scored) == 1:
        _, p = scored[0]
        return p[0], p[1], p[2], p[4]

    # Passe 2 : départage par date de naissance
    if birth_date:
        for score, p in sorted(scored, reverse=True):
            db_dob = p[3]  # date_naissance stockée en base (format YYYY-MM-DD)
            if db_dob and db_dob == birth_date:
                return p[0], p[1], p[2], p[4]

    # Fallback : meilleur score fuzzy
    scored.sort(key=lambda x: x[0], reverse=True)
    _, best = scored[0]
    return best[0], best[1], best[2], best[4]


# ─── Pipeline principal ────────────────────────────────────────────────────────
def process_all():
    print("📋 Récupération des joueurs...")
    # date_naissance peut ne pas exister dans toutes les tables -> fallback sans elle
    try:
        joueuses = supabase.table("joueuses").select("id, prenom, nom, date_naissance").execute().data
    except Exception:
        joueuses = supabase.table("joueuses").select("id, prenom, nom").execute().data

    try:
        staff = supabase.table("staff").select("id, prenom, nom, date_naissance").execute().data
    except Exception:
        staff = supabase.table("staff").select("id, prenom, nom").execute().data

    print("📂 Scan du bucket...")
    files = supabase.storage.from_(BUCKET).list()

    # Collecte des échecs pour le récap final
    unidentified: list[dict] = []

    for f in files:
        name = f['name']
        if not name.endswith('.pdf'):
            continue

        print(f"\n──────────────────────────────")
        print(f"📄 Traitement : {name}")

        try:
            raw_data = supabase.storage.from_(BUCKET).download(name)
            reader   = PdfReader(io.BytesIO(raw_data))
            pages    = [page.extract_text() or "" for page in reader.pages]
            full_text = "\n".join(pages)

            # 1. PNR & identité (sur l'ensemble du document)
            pnr        = extract_pnr(full_text)
            candidates = extract_name_candidates(full_text)
            birth_date = extract_birth_date(full_text)
            match      = find_joueuse(candidates, birth_date, joueuses, staff)

            if not match:
                print(f"⚠️  Personne introuvable | candidats extraits : {candidates}")
                unidentified.append({
                    "fichier":    name,
                    "pnr":        pnr,
                    "candidats":  candidates,
                    "texte_brut": full_text[:800],
                })
                continue

            person_id, prenom_j, nom_j, person_type = match
            new_name = f"{pnr}_{slugify(nom_j)}_{slugify(prenom_j)}.pdf"
            print(f"👤 {person_type.capitalize()} identifié·e : {prenom_j} {nom_j} (id={person_id})")

            # 2. Vérification doublon
            check = supabase.table("billets").select("id").eq("nom_fichier", new_name).execute()
            if check.data:
                print(f"⏭️  Déjà traité : {new_name}")
                continue

            # 3. Insertion du billet
            # joueuse_id accueille les IDs joueuses ET staff (FK supprimée côté Supabase)
            # personne_type distingue les deux pour les requêtes applicatives
            billet_res = supabase.table("billets").insert({
                "nom_fichier":    new_name,
                "url_stockage":   new_name,
                "joueuse_id":     person_id,
                "personne_type":  person_type,   # "joueuse" ou "staff"
            }).execute()

            if not billet_res.data:
                print(f"❌ Échec insertion billet : {billet_res}")
                continue

            billet_id = billet_res.data[0]['id']
            print(f"✅ Billet inséré id={billet_id}")

            # 4. Segments — traitement page par page
            #    Un PDF multi-pages peut avoir un trajet par page (TGV INOUI)
            #    ou plusieurs segments par page (TER avec correspondance)
            total_segments = 0
            for page_idx, page_text in enumerate(pages):
                segments = parse_segments_from_page(page_text)

                if not segments:
                    print(f"   Page {page_idx+1} : aucun segment détecté")
                    continue

                for seg in segments:
                    trajet_res = supabase.table("trajets").insert({
                        "billet_id":    billet_id,
                        "gare_depart":  seg["gare_depart"],
                        "gare_arrivee": seg["gare_arrivee"],
                        "date_depart":  seg["date_depart"],
                        "heure_depart": seg["heure_depart"],
                        "heure_arrivee": seg["heure_arrivee"],
                        "type_train":   seg["type_train"],
                        "numero_train": seg["numero_train"],
                    }).execute()

                    if trajet_res.data:
                        total_segments += 1
                        print(
                            f"   🚆 {seg['type_train']} {seg['numero_train']} | "
                            f"{seg['gare_depart']} {seg['heure_depart']} → "
                            f"{seg['gare_arrivee']} {seg['heure_arrivee']} "
                            f"({seg['date_depart']})"
                        )

            print(f"   → {total_segments} segment(s) inséré(s)")

            # 5. Renommage dans le bucket Storage
            if name != new_name:
                supabase.storage.from_(BUCKET).copy(name, new_name)
                supabase.storage.from_(BUCKET).remove([name])
                print(f"   📁 Renommé : {name} → {new_name}")

        except Exception as e:
            print(f"❌ Erreur critique sur {name} : {e}")
            import traceback; traceback.print_exc()

    # ─── Récapitulatif des échecs ──────────────────────────────────────────────
    print("\n\n══════════════════════════════════════════")
    if not unidentified:
        print("✅ Tous les billets ont été identifiés.")
    else:
        print(f"⚠️  {len(unidentified)} billet(s) non identifié(s) :\n")
        for item in unidentified:
            print(f"  Fichier   : {item['fichier']}")
            print(f"  PNR       : {item['pnr']}")
            print(f"  Candidats : {item['candidats'] or '(aucun)'}")
            print(f"  ── Texte extrait (800 premiers caractères) ──")
            for line in item['texte_brut'].splitlines():
                if line.strip():
                    print(f"  │ {line}")
            print()
        print("→ Renvoie ces billets pour qu'on affine l'extraction.")
    print("══════════════════════════════════════════")


if __name__ == "__main__":
    process_all()
