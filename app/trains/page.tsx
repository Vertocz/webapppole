"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import ThemeProvider from "@/components/ThemeProvider";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Person {
  id: string;
  prenom: string;
  nom: string;
  categorie?: string;
  gare?: string;
  _table: "joueur" | "staff";
}

interface Place {
  id: string;     // ex: "stop_area:SNCF:87481002"
  name: string;
}

interface Leg {
  from:                  { name: string };
  to:                    { name: string };
  departure_date_time?:  string;
  arrival_date_time?:    string;
  display_informations?: { commercial_mode: string; label: string; network: string };
  type:                  string;
}

interface Journey {
  departure_date_time: string; // YYYYMMDDTHHmmss
  arrival_date_time:   string;
  duration:            number; // secondes
  nb_transfers:        number;
  sections:            Leg[];
  status?:             string;
}

interface PersonResult {
  person:   Person;
  journeys: Journey[];
  error?:   string;
  loading:  boolean;
}

const accent = "#E8641C";

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(s: unknown): string {
  try {
    if (s == null || typeof s !== "string" || s.length < 15) return "—";
    const iso = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}`;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
}

function toSncfDatetime(date: string, time: string): string {
  // date: YYYY-MM-DD, time: HH:mm → YYYYMMDDTHHmmss
  return `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function TrainsPage() {
  const router = useRouter();
  const [authOk, setAuthOk] = useState(false);

  // Données
  const [allPersons,    setAllPersons]    = useState<Person[]>([]);
  const [selected,      setSelected]      = useState<Set<string>>(new Set());
  const [poleFilter,    setPoleFilter]    = useState<"tous" | "masculin" | "feminin">("tous");

  // Formulaire
  const [destQuery,     setDestQuery]     = useState("");
  const [destPlace,     setDestPlace]     = useState<Place | null>(null);
  const [suggestions,   setSuggestions]   = useState<Place[]>([]);
  const [loadingSugg,   setLoadingSugg]   = useState(false);
  const [date,          setDate]          = useState(() => new Date().toISOString().split("T")[0]);
  const [arrivalTime,   setArrivalTime]   = useState("10:00");
  const suggRef = useRef<HTMLDivElement>(null);

  // Résultats
  const [results,    setResults]    = useState<PersonResult[]>([]);
  const [searching,  setSearching]  = useState(false);
  const [expanded,   setExpanded]   = useState<string | null>(null);

  // ── Auth ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const type = sessionStorage.getItem("type_user");
    if (type !== "staff") { router.push("/"); return; }
    setAuthOk(true);
  }, [router]);

  // ── Chargement joueurs + staff ─────────────────────────────────────────────
  useEffect(() => {
    if (!authOk) return;
    async function load() {
      const [{ data: joueurs }, { data: staff }] = await Promise.all([
        supabase.from("joueuses").select("id, prenom, nom, categorie, gare").order("nom"),
        supabase.from("staff").select("id, prenom, nom, gare").order("nom"),
      ]);
      const j: Person[] = (joueurs ?? []).map(p => ({ ...p, _table: "joueur" as const }));
      const s: Person[] = (staff ?? []).map(p => ({ ...p, _table: "staff" as const }));
      setAllPersons([...j, ...s]);
    }
    load();
  }, [authOk]);

  // ── Autocomplete destination ───────────────────────────────────────────────
  useEffect(() => {
    if (destQuery.length < 2) { setSuggestions([]); return; }
    if (destPlace && destQuery === destPlace.name) return; // déjà sélectionné
    const timer = setTimeout(async () => {
      setLoadingSugg(true);
      try {
        const res  = await fetch(`/api/sncf/places?q=${encodeURIComponent(destQuery)}`);
        const data = await res.json();
        const places: Place[] = (data.places ?? []).map((p: { id: string; stop_area?: { name: string }; name?: string }) => ({
          id:   p.id,
          name: p.stop_area?.name ?? p.name ?? p.id,
        }));
        setSuggestions(places);
      } finally {
        setLoadingSugg(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [destQuery, destPlace]);

  // Fermer suggestions si clic extérieur
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (suggRef.current && !suggRef.current.contains(e.target as Node))
        setSuggestions([]);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // ── Filtrage personnes ─────────────────────────────────────────────────────
  const visiblePersons = allPersons.filter(p => {
    if (!p.gare) return false; // pas de gare renseignée → pas affichée
    if (poleFilter === "masculin") return p._table === "joueur" && p.categorie === "Masculin";
    if (poleFilter === "feminin")  return p._table === "joueur" && p.categorie === "Féminin";
    return true;
  });

  const togglePerson = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(visiblePersons.map(p => p.id)));
  const clearAll  = () => setSelected(new Set());

  // ── Résolution gare → ID SNCF ──────────────────────────────────────────────
  const resolveGare = useCallback(async (gare: string): Promise<Place | null> => {
    const res  = await fetch(`/api/sncf/places?q=${encodeURIComponent(gare)}`);
    const data = await res.json();
    const p    = (data.places ?? [])[0];
    if (!p) return null;
    return { id: p.id, name: p.stop_area?.name ?? p.name ?? p.id };
  }, []);

  // ── Recherche ──────────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    if (!destPlace || selected.size === 0) return;
    setSearching(true);
    setExpanded(null);

    const persons = visiblePersons.filter(p => selected.has(p.id));
    const datetime = toSncfDatetime(date, arrivalTime);

    // Init résultats en loading
    setResults(persons.map(p => ({ person: p, journeys: [], loading: true })));

    // Requêtes en parallèle (par batch de 5 pour ne pas saturer l'API)
    const batchSize = 5;
    for (let i = 0; i < persons.length; i += batchSize) {
      const batch = persons.slice(i, i + batchSize);
      await Promise.all(batch.map(async (person) => {
        try {
          const garePlace = await resolveGare(person.gare!);
          if (!garePlace) throw new Error(`Gare "${person.gare}" introuvable`);

          // Double appel : trains qui arrivent AVANT + trains qui partent APRÈS l'heure cible
          const [resBefore, resAfter] = await Promise.all([
            fetch(`/api/sncf/journeys?from=${encodeURIComponent(garePlace.id)}&to=${encodeURIComponent(destPlace.id)}&datetime=${datetime}&represents=arrival`),
            fetch(`/api/sncf/journeys?from=${encodeURIComponent(garePlace.id)}&to=${encodeURIComponent(destPlace.id)}&datetime=${datetime}&represents=departure`),
          ]);
          const [dataBefore, dataAfter] = await Promise.all([resBefore.json(), resAfter.json()]);

          // Fusionner + dédoublonner par departure_date_time
          const seen = new Set<string>();
          const merged: Journey[] = [];
          for (const j of [...(dataBefore.journeys ?? []), ...(dataAfter.journeys ?? [])]) {
            const key = j.departure_date_time ?? Math.random().toString();
            if (!seen.has(key)) { seen.add(key); merged.push(j); }
          }

          // Trier par heure d'arrivée croissante
          const journeys = merged.sort((a, b) =>
            (a.arrival_date_time ?? "").localeCompare(b.arrival_date_time ?? "")
          );
          setResults(prev => prev.map(r =>
            r.person.id === person.id ? { ...r, journeys, loading: false } : r
          ));
        } catch (err) {
          setResults(prev => prev.map(r =>
            r.person.id === person.id
              ? { ...r, loading: false, error: err instanceof Error ? err.message : "Erreur" }
              : r
          ));
        }
      }));
    }
    setSearching(false);
  }, [destPlace, selected, visiblePersons, date, arrivalTime, resolveGare]);

  if (!authOk) return null;

  const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(43,80,160,0.3)",
    color: "var(--text-main)", borderRadius: "0.625rem",
    padding: "0.6rem 0.85rem", fontSize: "0.875rem", outline: "none", width: "100%",
  };

  return (
    <>
      <ThemeProvider theme="staff" />
      <div className="relative min-h-screen z-10" style={{ background: "var(--bg-base)" }}>

        {/* Stripe top */}
        <div className="h-0.5 w-full"
          style={{ background: "linear-gradient(90deg,var(--primary),var(--accent),var(--primary))" }} />

        {/* Header */}
        <header className="sticky top-0 z-50 px-4 py-3"
          style={{ background: "color-mix(in srgb, var(--bg-base) 92%, transparent)",
            backdropFilter: "blur(14px)", borderBottom: "1px solid var(--border)" }}>
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <button onClick={() => router.back()}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-opacity hover:opacity-70"
              style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>←</button>
            <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0" style={{ background: "white", padding: "3px" }}>
              <Image src="/logo.png" alt="Logo" width={30} height={30} style={{ objectFit: "contain" }} />
            </div>
            <div>
              <p className="font-display text-base leading-none" style={{ color: "var(--text-main)" }}>TRAINS</p>
              <p className="text-[10px] tracking-widest uppercase font-light" style={{ color: "var(--text-sub)" }}>
                Recherche d&apos;itinéraires
              </p>
            </div>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">

          {/* ── Formulaire ──────────────────────────────────────────────────── */}
          <div className="rounded-2xl p-5 space-y-4"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>

            <p className="text-xs font-bold tracking-widest uppercase" style={{ color: accent }}>
              PARAMÈTRES
            </p>

            {/* Destination avec autocomplete */}
            <div className="relative" ref={suggRef}>
              <label className="text-[11px] uppercase tracking-widest mb-1.5 block" style={{ color: "var(--text-sub)" }}>
                Gare d&apos;arrivée
              </label>
              <input
                value={destQuery}
                onChange={e => { setDestQuery(e.target.value); setDestPlace(null); }}
                placeholder="Ex : Paris Montparnasse"
                style={{
                  ...inputStyle,
                  borderColor: destPlace ? `${accent}66` : "rgba(43,80,160,0.3)",
                }}
              />
              {destPlace && (
                <span className="absolute right-3 top-[2.4rem] text-xs" style={{ color: accent }}>✓</span>
              )}
              {loadingSugg && (
                <div className="absolute right-3 top-[2.4rem] w-4 h-4 rounded-full border-2 animate-spin"
                  style={{ borderColor: accent, borderTopColor: "transparent" }} />
              )}
              {suggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 rounded-xl overflow-hidden shadow-2xl"
                  style={{ background: "#0E1E38", border: "1px solid rgba(43,80,160,0.4)" }}>
                  {suggestions.map(s => (
                    <button key={s.id}
                      onClick={() => { setDestPlace(s); setDestQuery(s.name); setSuggestions([]); }}
                      className="w-full text-left px-4 py-3 text-sm transition-colors hover:bg-white/5"
                      style={{ color: "var(--text-main)", borderBottom: "1px solid rgba(43,80,160,0.15)" }}>
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Date + heure */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] uppercase tracking-widest mb-1.5 block" style={{ color: "var(--text-sub)" }}>
                  Date
                </label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-widest mb-1.5 block" style={{ color: "var(--text-sub)" }}>
                  Arrivée souhaitée
                </label>
                <input type="time" value={arrivalTime} onChange={e => setArrivalTime(e.target.value)} style={inputStyle} />
              </div>
            </div>
          </div>

          {/* ── Sélection personnes ──────────────────────────────────────────── */}
          <div className="rounded-2xl overflow-hidden"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>

            {/* Header sélection */}
            <div className="px-5 py-3 flex items-center justify-between"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <p className="text-xs font-bold tracking-widest uppercase" style={{ color: accent }}>
                CONVOQUÉS ({selected.size})
              </p>
              <div className="flex items-center gap-2">
                {/* Filtre pôle */}
                {(["tous", "masculin", "feminin"] as const).map(f => (
                  <button key={f} onClick={() => { setPoleFilter(f); clearAll(); }}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all"
                    style={{
                      background: poleFilter === f ? `${accent}25` : "rgba(255,255,255,0.04)",
                      border: `1px solid ${poleFilter === f ? accent + "55" : "rgba(43,80,160,0.2)"}`,
                      color: poleFilter === f ? accent : "var(--text-muted)",
                    }}>
                    {f === "tous" ? "Tous" : f === "masculin" ? "♂ Masc" : "♀ Fém"}
                  </button>
                ))}
              </div>
            </div>

            {/* Tout / Aucun */}
            <div className="px-5 py-2 flex gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <button onClick={selectAll} className="text-xs" style={{ color: "var(--text-muted)" }}>
                Tout sélectionner
              </button>
              <span style={{ color: "var(--border)" }}>·</span>
              <button onClick={clearAll} className="text-xs" style={{ color: "var(--text-muted)" }}>
                Tout désélectionner
              </button>
            </div>

            {/* Liste */}
            <div className="max-h-72 overflow-y-auto">
              {visiblePersons.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>
                  Aucune personne avec une gare renseignée dans ce pôle
                </p>
              ) : visiblePersons.map((p, i) => {
                const sel = selected.has(p.id);
                return (
                  <button key={p.id} onClick={() => togglePerson(p.id)}
                    className="w-full flex items-center gap-3 px-5 py-3 text-left transition-colors"
                    style={{
                      background: sel ? `${accent}0D` : "transparent",
                      borderBottom: i < visiblePersons.length - 1 ? "1px solid var(--border)" : "none",
                    }}>
                    <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all"
                      style={{ borderColor: sel ? accent : "rgba(43,80,160,0.4)",
                        background: sel ? accent : "transparent" }}>
                      {sel && <span className="text-white text-[10px] font-bold">✓</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
                        {p.prenom} {p.nom.toUpperCase()}
                      </p>
                      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {p.gare}
                        {p._table === "staff" && (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold"
                            style={{ background: "rgba(100,160,255,0.15)", color: "#64A0FF" }}>
                            STAFF
                          </span>
                        )}
                      </p>
                    </div>
                    {p.categorie && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                        style={{
                          background: p.categorie === "Masculin" ? "rgba(59,130,246,0.12)" : "rgba(236,72,153,0.12)",
                          color: p.categorie === "Masculin" ? "#60a5fa" : "#f472b6",
                        }}>
                        {p.categorie === "Masculin" ? "M" : "F"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Bouton recherche ─────────────────────────────────────────────── */}
          <button
            onClick={handleSearch}
            disabled={!destPlace || selected.size === 0 || searching}
            className="w-full py-4 rounded-2xl font-display text-sm tracking-widest transition-all disabled:opacity-40"
            style={{
              background: `linear-gradient(135deg, ${accent}88, ${accent})`,
              color: "white",
              boxShadow: destPlace && selected.size > 0 ? `0 4px 24px ${accent}44` : "none",
            }}>
            {searching
              ? "Recherche en cours…"
              : `RECHERCHER LES TRAINS (${selected.size} personne${selected.size > 1 ? "s" : ""})`}
          </button>

          {/* ── Résultats ────────────────────────────────────────────────────── */}
          {results.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-bold tracking-widest uppercase px-1" style={{ color: "var(--text-sub)" }}>
                RÉSULTATS — autour de {arrivalTime} le {new Date(date + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
              </p>

              {results.map(r => (
                <div key={r.person.id} className="rounded-2xl overflow-hidden"
                  style={{ border: `1px solid ${r.error ? "rgba(248,113,113,0.25)" : "var(--border)"}`,
                    background: "var(--bg-card)" }}>

                  {/* Ligne résumé */}
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02]"
                    onClick={() => setExpanded(e => e === r.person.id ? null : r.person.id)}
                    disabled={r.loading || !!r.error || r.journeys.length === 0}>

                    {/* Statut */}
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-sm"
                      style={{
                        background: r.loading ? "rgba(255,255,255,0.05)"
                          : r.error ? "rgba(248,113,113,0.12)"
                          : r.journeys.length === 0 ? "rgba(255,255,255,0.05)"
                          : "rgba(99,200,120,0.12)",
                      }}>
                      {r.loading
                        ? <div className="w-4 h-4 rounded-full border-2 animate-spin"
                            style={{ borderColor: accent, borderTopColor: "transparent" }} />
                        : r.error ? "✗"
                        : r.journeys.length === 0 ? "—"
                        : "✓"}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
                        {r.person.prenom} {r.person.nom.toUpperCase()}
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                        {r.loading ? "Recherche…"
                          : r.error ? r.error
                          : r.journeys.length === 0 ? "Aucun trajet trouvé"
                          : (() => {
                              const j = r.journeys[0];
                              return `${r.person.gare} → Départ ${formatTime(j.departure_date_time)} · Arrivée ${formatTime(j.arrival_date_time)} · ${formatDuration(j.duration)}${j.nb_transfers > 0 ? ` · ${j.nb_transfers} corresp.` : ""}`;
                            })()
                        }
                      </p>
                    </div>

                    {!r.loading && !r.error && r.journeys.length > 0 && (
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                          Tarifs : SNCF Connect
                        </span>
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {expanded === r.person.id ? "▲" : "▼"}
                        </span>
                      </div>
                    )}
                  </button>

                  {/* Détail déroulant */}
                  {expanded === r.person.id && r.journeys.length > 0 && (
                    <div style={{ borderTop: "1px solid var(--border)" }}>
                      {r.journeys.map((j, ji) => (
                        <div key={ji} className="px-4 py-3"
                          style={{ borderBottom: ji < r.journeys.length - 1 ? "1px solid var(--border)" : "none",
                            background: ji === 0 ? `${accent}07` : "transparent" }}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              {(() => {
                                const isAfter = (j.arrival_date_time ?? "") > toSncfDatetime(date, arrivalTime);
                                return (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                    style={{
                                      background: isAfter ? "rgba(248,113,113,0.15)" : "rgba(99,200,120,0.15)",
                                      color: isAfter ? "#f87171" : "#63C878",
                                    }}>
                                    {isAfter ? `Après ${arrivalTime} ✗` : `Avant ${arrivalTime} ✓`}
                                  </span>
                                );
                              })()}
                              <span className="text-sm font-bold" style={{ color: "var(--text-main)" }}>
                                {formatTime(j.departure_date_time)} → {formatTime(j.arrival_date_time)}
                              </span>
                            </div>
                            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                              {formatDuration(j.duration)}
                            </span>
                          </div>

                          {/* Segments du trajet — vue épurée */}
                          <div className="mt-2 space-y-0">
                            {j.sections
                              .filter(s => s.type === "public_transport" || s.type === "transfer" || s.type === "waiting")
                              .reduce((acc: typeof j.sections, s) => {
                                // Fusionner les sections transfer/waiting avec le segment précédent
                                if (s.type === "public_transport") acc.push(s);
                                return acc;
                              }, [])
                              .map((s, si, arr) => {
                                const trainName = s.display_informations?.label
                                  ? `${s.display_informations.commercial_mode ?? ""} ${s.display_informations.label}`.trim()
                                  : "Train";
                                const isLast = si === arr.length - 1;
                                return (
                                  <div key={si}>
                                    {/* Ligne de train */}
                                    <div className="flex items-center gap-2 py-1.5">
                                      <div className="flex flex-col items-center gap-0.5 flex-shrink-0 w-10">
                                        <span className="text-[11px] font-bold tabular-nums" style={{ color: "var(--text-main)" }}>
                                          {formatTime(s.departure_date_time)}
                                        </span>
                                      </div>
                                      <div className="flex flex-col flex-1 min-w-0">
                                        <span className="text-[11px] font-medium truncate" style={{ color: "var(--text-main)" }}>
                                          {s.from.name.replace(/ \(.*\)/, "")}
                                        </span>
                                        <span className="text-[9px] font-bold tracking-wider mt-0.5"
                                          style={{ color: "#64A0FF" }}>
                                          {trainName}
                                        </span>
                                      </div>
                                    </div>
                                    {/* Ligne d'arrivée */}
                                    <div className="flex items-center gap-2 pb-1.5"
                                      style={{ borderBottom: !isLast ? "1px dashed rgba(43,80,160,0.25)" : "none" }}>
                                      <div className="flex flex-col items-center flex-shrink-0 w-10">
                                        <span className="text-[11px] font-bold tabular-nums" style={{ color: "var(--text-main)" }}>
                                          {formatTime(s.arrival_date_time)}
                                        </span>
                                      </div>
                                      <span className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                                        {s.to.name.replace(/ \(.*\)/, "")}
                                      </span>
                                    </div>
                                    {/* Correspondance */}
                                    {!isLast && (
                                      <div className="flex items-center gap-2 py-1 pl-12">
                                        <span className="text-[10px] italic" style={{ color: "var(--text-muted)" }}>
                                          correspondance
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                          </div>

                          {j.nb_transfers > 0 && (
                            <p className="text-[10px] mt-1.5" style={{ color: "var(--text-muted)" }}>
                              {j.nb_transfers} correspondance{j.nb_transfers > 1 ? "s" : ""}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

        </main>
      </div>
    </>
  );
}