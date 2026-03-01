import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Supabase avec clé service (pour pouvoir copier/supprimer dans le storage)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Normalisation ───────────────────────────────────────────────────────────
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // accents
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Parsing date ─────────────────────────────────────────────────────────────
const MOIS: Record<string, string> = {
  janvier: "01", février: "02", fevrier: "02", mars: "03", avril: "04",
  mai: "05", juin: "06", juillet: "07", août: "08", aout: "08",
  septembre: "09", octobre: "10", novembre: "11", décembre: "12", decembre: "12",
};

function parseDate(text: string): string | null {
  const norm = normalize(text);

  // Format "DD/MM/YYYY" ou "DD/MM/YY"
  const slashMatch = norm.match(/\b(\d{1,2})\/(\d{2})\/(\d{2,4})\b/);
  if (slashMatch) {
    const [, d, m, y] = slashMatch;
    const year = y.length === 2 ? "20" + y : y;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Format "Samedi 28 février 2026" / "MARDI 3 MARS 2026" / "aller le 03/03/2026"
  const longMatch = norm.match(
    /(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)?\s*(\d{1,2})\s+(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\s+(\d{4})/
  );
  if (longMatch) {
    const [, d, m, y] = longMatch;
    return `${y}-${MOIS[m]}-${d.padStart(2, "0")}`;
  }

  // "Aller le 03/03/2026"
  const allerMatch = norm.match(/aller le\s+(\d{1,2})\/(\d{2})\/(\d{4})/);
  if (allerMatch) {
    const [, d, m, y] = allerMatch;
    return `${y}-${m}-${d.padStart(2, "0")}`;
  }

  return null;
}

// ─── Extraction selon le format du billet ────────────────────────────────────
interface Extracted {
  prenom: string | null;
  nom: string | null;
  depart: string | null;
  arrivee: string | null;
  date: string | null;
}

function extractOuigo(text: string): Extracted {
  // Nom : "AYOUB LAANAIT - 1994"
  const nomMatch = text.match(/^([A-ZÉÈÀÙÂÊÎÔÛÄËÏÖÜ][A-ZÉÈÀÙÂÊÎÔÛÄËÏÖÜ\s-]+?)\s*-\s*\d{4}/m);
  let prenom: string | null = null;
  let nom: string | null = null;
  if (nomMatch) {
    const parts = nomMatch[1].trim().split(/\s+/);
    prenom = parts[0];
    nom = parts.slice(1).join(" ") || null;
  }

  // Gare départ/arrivée : deux lignes après l'heure de départ
  // Pattern : "11h52 Bordeaux Saint-Jean\n12h31 Angouleme"
  const trajetMatch = text.match(/\d{1,2}h\d{2}\s+(.+?)\n\d{1,2}h\d{2}\s+(.+)/);
  const depart = trajetMatch ? trajetMatch[1].trim() : null;
  const arrivee = trajetMatch ? trajetMatch[2].trim() : null;

  const date = parseDate(text);
  return { prenom, nom, depart, arrivee, date };
}

function extractTER(text: string): Extracted {
  // TER : "CADET\nERWAN" (NOM en caps, puis PRENOM en caps)
  // "DE : LILLE FLANDRES\nÀ : CALAIS VILLE"
  const nomMatch = text.match(/^([A-ZÉÈÀÙÂÊÎÔÛÄËÏÖÜ-]+)\n([A-ZÉÈÀÙÂÊÎÔÛÄËÏÖÜ-]+)\n\d{2}\/\d{2}\/\d{4}/m);
  const nom = nomMatch ? nomMatch[1].trim() : null;
  const prenom = nomMatch ? nomMatch[2].trim() : null;

  const departMatch = text.match(/DE\s*:\s*(.+)/i);
  const arriveeMatch = text.match(/[AÀ]\s*:\s*(.+)/i);
  const depart = departMatch ? departMatch[1].trim() : null;
  const arrivee = arriveeMatch ? arriveeMatch[1].trim() : null;

  const date = parseDate(text);
  return { prenom, nom, depart, arrivee, date };
}

function extractTGV(text: string): Extracted {
  // TGV : "Nom : SEJOR\nPrénom : Gregory"
  const nomMatch = text.match(/Nom\s*:\s*([^\n]+)/i);
  const prenomMatch = text.match(/Prénom\s*:\s*([^\n]+)/i);
  const nom = nomMatch ? nomMatch[1].trim() : null;
  const prenom = prenomMatch ? prenomMatch[1].trim() : null;

  // Trajet : premier billet uniquement (avant "BON À SAVOIR")
  // "11h17 AÉROPORT ROISSY CDG 2 TGV\n...\n13h04 SAINT-PIERRE DES CORPS"
  const firstBillet = text.split(/BON À SAVOIR|Bon à savoir/)[0];
  const trajetMatch = firstBillet.match(/\d{1,2}h\d{2}\s+(.+?)\n[\s\S]*?\d{1,2}h\d{2}\s+([^\n]+)/);
  let depart = trajetMatch ? trajetMatch[1].trim() : null;
  let arrivee = trajetMatch ? trajetMatch[2].trim() : null;

  // Nettoyer les suffixes de gare (ex: "AÉROPORT ROISSY CDG 2 TGV" → garder tel quel)
  // Supprimer "TGV INOUI XXXX - 2e CLASSE" si ça parasite
  const unwanted = /TGV INOUI\s+\d+|2e CLASSE|1ère CLASSE/gi;
  if (depart) depart = depart.replace(unwanted, "").trim();
  if (arrivee) arrivee = arrivee.replace(unwanted, "").trim();

  const date = parseDate(firstBillet);
  return { prenom, nom, depart, arrivee, date };
}

function detectFormatAndExtract(text: string): Extracted {
  const upper = text.toUpperCase();
  if (upper.includes("OUIGO")) return extractOuigo(text);
  if (upper.includes("TGV INOUI") || upper.includes("TGV INOUÏ")) return extractTGV(text);
  if (upper.includes("TER") || upper.includes("DE :") || upper.includes("À :")) return extractTER(text);
  // Fallback : tenter TGV puis TER
  const tgv = extractTGV(text);
  if (tgv.nom && tgv.depart) return tgv;
  return extractTER(text);
}

function buildFilename(info: Extracted, originalName: string): string | null {
  if (!info.depart || !info.arrivee || (!info.nom && !info.prenom)) return null;

  const dep = slugify(info.depart);
  const arr = slugify(info.arrivee);
  const nom = slugify([info.prenom, info.nom].filter(Boolean).join(" "));
  const date = info.date ?? "DATE-INCONNUE";

  return `${dep}-${arr}_${nom}_${date}.pdf`;
}

// ─── Route handler ────────────────────────────────────────────────────────────
export async function POST() {
  const BUCKET = "Billets";
  const results: { original: string; nouveau: string | null; statut: "renommé" | "ignoré" | "erreur"; detail?: string }[] = [];

  try {
    // Lister les fichiers
    const { data: files, error: listError } = await supabaseAdmin.storage.from(BUCKET).list();
    if (listError) throw new Error("Erreur listage bucket : " + listError.message);
    if (!files || files.length === 0) return NextResponse.json({ results: [] });

    const pdfFiles = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));

    // Charger pdf-parse dynamiquement (évite les problèmes de SSR Next.js)
    const pdfParse = (await import("pdf-parse")).default;

    for (const file of pdfFiles) {
      const originalName = file.name;

      try {
        // Télécharger le PDF
        const { data: fileData, error: dlError } = await supabaseAdmin.storage
          .from(BUCKET)
          .download(originalName);
        if (dlError || !fileData) throw new Error("Téléchargement impossible");

        const buffer = Buffer.from(await fileData.arrayBuffer());
        const parsed = await pdfParse(buffer);
        const text = parsed.text;

        // Extraire les infos
        const info = detectFormatAndExtract(text);
        const nouveauNom = buildFilename(info, originalName);

        if (!nouveauNom) {
          results.push({ original: originalName, nouveau: null, statut: "ignoré", detail: "Extraction incomplète" });
          continue;
        }

        // Si le nom est identique, pas besoin de renommer
        if (nouveauNom === originalName) {
          results.push({ original: originalName, nouveau: nouveauNom, statut: "ignoré", detail: "Nom déjà correct" });
          continue;
        }

        // Copier avec le nouveau nom
        const { error: copyError } = await supabaseAdmin.storage
          .from(BUCKET)
          .copy(originalName, nouveauNom);
        if (copyError) throw new Error("Copie échouée : " + copyError.message);

        // Supprimer l'ancien
        await supabaseAdmin.storage.from(BUCKET).remove([originalName]);

        // Mettre à jour la table billets
        await supabaseAdmin
          .from("billets")
          .update({ nom_fichier: nouveauNom, url_stockage: nouveauNom })
          .eq("nom_fichier", originalName);

        results.push({ original: originalName, nouveau: nouveauNom, statut: "renommé" });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ original: originalName, nouveau: null, statut: "erreur", detail: msg });
      }
    }

    return NextResponse.json({ results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
