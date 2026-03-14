"use client";

/**
 * ExportPDFModal
 * ─────────────────────────────────────────────────────────────────────────────
 * Packages requis : npm install jspdf html2canvas
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Joueuse, Activite } from "@/types";

interface PlayerData { joueur: Joueuse; activites: Activite[] }

function dateMinus(days: number) {
  const d = new Date(); d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}
function avg(arr: number[]) {
  if (!arr.length) return 0;
  return Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}
function fmtDateLong() {
  return new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

async function fetchPlayerData(joueur: Joueuse): Promise<PlayerData> {
  const { data } = await supabase
    .from("activites").select("*")
    .eq("joueuse_id", joueur.id)
    .gte("date", dateMinus(30))
    .order("date", { ascending: false });
  return { joueur, activites: data ?? [] };
}

// ─── SVG chart (pas de recharts → html2canvas friendly) ───────────────────────
function SportifSVGChart({ activites }: { activites: Activite[] }) {
  const W = 694, H = 150;
  const PAD = { top: 12, right: 8, bottom: 26, left: 30 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top - PAD.bottom;

  const byDate: Record<string, { diff: number[]; plaisir: number[] }> = {};
  for (const a of [...activites].reverse()) {
    if (!byDate[a.date]) byDate[a.date] = { diff: [], plaisir: [] };
    byDate[a.date].diff.push(a.difficulte);
    byDate[a.date].plaisir.push(a.plaisir);
  }
  const pts = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ label: fmtDate(date), diff: avg(v.diff), plaisir: avg(v.plaisir) }));

  if (pts.length < 2) return (
    <svg width={W} height={H}>
      <text x={W/2} y={H/2} textAnchor="middle" fontSize={11} fill="#9ca3af">Pas assez de données</text>
    </svg>
  );

  const x = (i: number) => PAD.left + (i / (pts.length - 1)) * iW;
  const y = (v: number) => PAD.top + iH - (v / 10) * iH;
  const poly = (k: "diff" | "plaisir") => pts.map((p, i) => `${x(i)},${y(p[k])}`).join(" ");
  const step = Math.max(1, Math.ceil(pts.length / 8));
  const lblIdx = pts.map((_, i) => i).filter(i => i === 0 || i === pts.length - 1 || i % step === 0);

  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      {[0,2,4,6,8,10].map(v => (
        <g key={v}>
          <line x1={PAD.left} y1={y(v)} x2={PAD.left+iW} y2={y(v)}
            stroke="#e5e7eb" strokeWidth={0.6} strokeDasharray={v===0?"none":"3,3"} />
          <text x={PAD.left-5} y={y(v)+3.5} textAnchor="end" fontSize={8} fill="#9ca3af">{v}</text>
        </g>
      ))}
      <polygon points={`${x(0)},${y(0)} ${pts.map((p,i)=>`${x(i)},${y(p.diff)}`).join(" ")} ${x(pts.length-1)},${y(0)}`}
        fill="#ef4444" opacity={0.07} />
      <polygon points={`${x(0)},${y(0)} ${pts.map((p,i)=>`${x(i)},${y(p.plaisir)}`).join(" ")} ${x(pts.length-1)},${y(0)}`}
        fill="#22c55e" opacity={0.07} />
      <polyline points={poly("diff")} fill="none" stroke="#ef4444" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={poly("plaisir")} fill="none" stroke="#22c55e" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p,i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.diff)} r={2.5} fill="#ef4444" />
          <circle cx={x(i)} cy={y(p.plaisir)} r={2.5} fill="#22c55e" />
        </g>
      ))}
      {lblIdx.map(i => (
        <text key={i} x={x(i)} y={H-5} textAnchor="middle" fontSize={8} fill="#6b7280">{pts[i].label}</text>
      ))}
    </svg>
  );
}

function ScoreBadge({ value, max }: { value: number; max: number }) {
  const p = value / max;
  const bg = p>=0.8?"#dcfce7":p>=0.5?"#fef9c3":"#fee2e2";
  const c  = p>=0.8?"#15803d":p>=0.5?"#92400e":"#b91c1c";
  return <span style={{ display:"inline-block", padding:"1px 7px", borderRadius:4, background:bg, color:c, fontWeight:700, fontSize:10 }}>{value}/{max}</span>;
}

// ─── Page A4 794×1123px ───────────────────────────────────────────────────────
function PlayerPrintPage({ data }: { data: PlayerData }) {
  const { joueur, activites } = data;
  const nbSeances  = activites.length;
  const avgDiff    = avg(activites.map(a => a.difficulte));
  const avgPlaisir = avg(activites.map(a => a.plaisir));
  const sports     = [...new Set(activites.map(a => a.sport.replace(/^[^\s]+\s/,"")))];
  const avecComm   = activites.filter(a => a.commentaire?.trim()).length;

  const S: React.CSSProperties = { fontFamily:"'Helvetica Neue',Arial,sans-serif" };

  return (
    <div style={{ ...S, width:794, height:1123, background:"#fff", color:"#111827",
      padding:"30px 38px", boxSizing:"border-box", overflow:"hidden", position:"relative" }}>

      {/* Bande top */}
      <div style={{ position:"absolute", top:0, left:0, right:0, height:4,
        background:"linear-gradient(90deg,#1B3A8C,#C49A28)" }} />

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
        <div>
          <div style={{ fontSize:8, fontWeight:600, letterSpacing:"0.15em", textTransform:"uppercase", color:"#6b7280", marginBottom:3 }}>
            Pôle France Para Basketball Adapté
          </div>
          <div style={{ fontSize:24, fontWeight:800, color:"#111827" }}>
            {joueur.prenom} {joueur.nom.toUpperCase()}
          </div>
          <div style={{ fontSize:10, color:"#6b7280", marginTop:2 }}>
            {joueur.categorie==="Masculin"?"Pôle Masculin":"Pôle Féminin"} · Suivi sportif — 30 derniers jours
          </div>
        </div>
        <div style={{ fontSize:8, color:"#9ca3af", paddingTop:6, textAlign:"right" }}>
          Export du {fmtDateLong()}
        </div>
      </div>

      <div style={{ height:1, background:"#e5e7eb", marginBottom:14 }} />

      {/* Chiffres clés */}
      <div style={{ display:"flex", gap:10, marginBottom:14 }}>
        {[
          { label:"Séances",          value:nbSeances.toString(),            sub:"sur 30 jours" },
          { label:"Difficulté moy.",  value:nbSeances?`${avgDiff}/10`:"—",   sub:"Intensité perçue" },
          { label:"Plaisir moy.",     value:nbSeances?`${avgPlaisir}/10`:"—",sub:"Engagement" },
          { label:"Sports",           value:sports.length.toString(),         sub:sports.slice(0,2).join(", ")||"—" },
          { label:"Avec commentaire", value:avecComm.toString(),              sub:`sur ${nbSeances} séances` },
        ].map(s => (
          <div key={s.label} style={{ flex:1, background:"#f9fafb", border:"1px solid #e5e7eb", borderRadius:8, padding:"9px 10px" }}>
            <div style={{ fontSize:7.5, color:"#6b7280", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:3 }}>{s.label}</div>
            <div style={{ fontSize:17, fontWeight:800, color:"#1B3A8C", lineHeight:1 }}>{s.value}</div>
            <div style={{ fontSize:7.5, color:"#9ca3af", marginTop:3, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Graphique */}
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:8.5, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase",
          color:"#374151", marginBottom:7, display:"flex", alignItems:"center", gap:12 }}>
          Évolution sur 30 jours
          <span style={{ display:"flex", alignItems:"center", gap:10, fontWeight:400, textTransform:"none", letterSpacing:0, fontSize:9 }}>
            <span style={{ display:"flex", alignItems:"center", gap:4 }}>
              <span style={{ display:"inline-block", width:18, height:2.5, background:"#ef4444", borderRadius:2 }} /> Difficulté
            </span>
            <span style={{ display:"flex", alignItems:"center", gap:4 }}>
              <span style={{ display:"inline-block", width:18, height:2.5, background:"#22c55e", borderRadius:2 }} /> Plaisir
            </span>
          </span>
        </div>
        <div style={{ background:"#f9fafb", border:"1px solid #e5e7eb", borderRadius:8, padding:"10px 8px 4px" }}>
          <SportifSVGChart activites={activites} />
        </div>
      </div>

      {/* Tableau activités */}
      <div>
        <div style={{ fontSize:8.5, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase",
          color:"#374151", marginBottom:7 }}>
          Détail des séances
        </div>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:9.5 }}>
          <thead>
            <tr style={{ background:"#1B3A8C" }}>
              {["Date","Sport","Durée","Diff.","Plaisir","Commentaire"].map((h,i) => (
                <th key={h} style={{ padding:"6px 8px", textAlign:"left", fontWeight:600, color:"#fff",
                  fontSize:8, letterSpacing:"0.06em",
                  borderRight: i<5?"1px solid rgba(255,255,255,0.1)":"none" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activites.length===0 ? (
              <tr><td colSpan={6} style={{ padding:"12px 8px", color:"#9ca3af", fontStyle:"italic", textAlign:"center" }}>
                Aucune activité sur cette période
              </td></tr>
            ) : activites.map((a, i) => (
              <tr key={a.id} style={{ background:i%2===0?"#fff":"#f8fafc", borderBottom:"1px solid #f1f5f9" }}>
                <td style={{ padding:"4px 8px", color:"#374151", whiteSpace:"nowrap" }}>{fmtDate(a.date)}</td>
                <td style={{ padding:"4px 8px", color:"#374151", maxWidth:150, overflow:"hidden",
                  textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.sport.replace(/^[\S]+\s/,"")}</td>
                <td style={{ padding:"4px 8px", color:"#374151", whiteSpace:"nowrap" }}>{a.duree}</td>
                <td style={{ padding:"4px 8px" }}><ScoreBadge value={a.difficulte} max={10} /></td>
                <td style={{ padding:"4px 8px" }}><ScoreBadge value={a.plaisir} max={10} /></td>
                <td style={{ padding:"4px 8px", color: a.commentaire?.trim()?"#374151":"#9ca3af",
                  fontStyle: a.commentaire?.trim()?"normal":"italic",
                  maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {a.commentaire?.trim()||"—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={{ position:"absolute", bottom:18, left:38, right:38,
        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ height:1, flex:1, background:"#e5e7eb" }} />
        <span style={{ fontSize:7.5, color:"#9ca3af", padding:"0 10px" }}>Confidentiel · {fmtDateLong()}</span>
        <div style={{ height:1, flex:1, background:"#e5e7eb" }} />
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────
type ExportStatus = "idle"|"fetching"|"rendering"|"done"|"error";

export default function ExportPDFModal({ joueurs, onClose }: { joueurs: Joueuse[]; onClose: () => void }) {
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [status,   setStatus]         = useState<ExportStatus>("idle");
  const [progress, setProgress]       = useState(0);
  const [datas,    setDatas]          = useState<PlayerData[]>([]);
  const printRef   = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const isExporting = status==="fetching"||status==="rendering";

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key==="Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const toggle    = (id: string) => setSelected(p => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const toggleAll = () => setSelected(selected.size === joueurs.length ? new Set() : new Set(joueurs.map(j => j.id)));

  const runExport = useCallback(async () => {
    if (!selected.size) return;
    setStatus("fetching"); setProgress(0);
    try {
      const list = joueurs.filter(j => selected.has(j.id));
      const res: PlayerData[] = [];
      for (let i=0; i<list.length; i++) {
        res.push(await fetchPlayerData(list[i]));
        setProgress(Math.round(((i+1)/list.length)*50));
      }
      setDatas(res); setStatus("rendering");
      await new Promise(r => setTimeout(r, 400));

      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"), import("html2canvas"),
      ]);
      const pdf   = new jsPDF({ orientation:"portrait", unit:"mm", format:"a4" });
      const pages = printRef.current?.querySelectorAll<HTMLDivElement>("[data-print-page]") ?? [];

      for (let i=0; i<pages.length; i++) {
        const canvas = await html2canvas(pages[i], { scale:2, useCORS:true, backgroundColor:"#ffffff", logging:false });
        if (i>0) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/jpeg",0.93), "JPEG", 0, 0, 210, 297);
        setProgress(50+Math.round(((i+1)/pages.length)*50));
      }
      pdf.save(`suivi_sportif_${new Date().toISOString().split("T")[0]}.pdf`);
      setStatus("done");
      setTimeout(onClose, 1200);
    } catch(err) {
      console.error("[ExportPDF]", err);
      setStatus("error");
    }
  }, [selected, joueurs, onClose]);

  const btnLabel = status==="done"?"✓ PDF TÉLÉCHARGÉ"
    : status==="error"?"ERREUR — RÉESSAYER"
    : isExporting?"..."
    : !selected.size?"SÉLECTIONNE DES JOUEURS"
    : `EXPORTER ${selected.size} JOUEUR${selected.size>1?"S":""}`;

  const btnBg = status==="done"?"linear-gradient(135deg,#22c55e,#16a34a)"
    : status==="error"?"linear-gradient(135deg,#ef4444,#b91c1c)"
    : !selected.size||isExporting?"rgba(27,58,140,0.25)"
    : "linear-gradient(135deg,#1B3A8C,#2952CC)";

  const masculin = joueurs.filter(j => j.categorie==="Masculin");
  const feminin  = joueurs.filter(j => j.categorie!=="Masculin");

  return (
    <>
      <div ref={backdropRef}
        className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
        style={{ background:"rgba(0,0,0,0.65)", backdropFilter:"blur(8px)" }}
        onClick={e => { if (e.target===backdropRef.current && !isExporting) onClose(); }}>

        <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl overflow-hidden animate-slide-in-up sm:animate-badge-pop"
          style={{ background:"linear-gradient(145deg,#0B1120,#0E1E38)",
            border:"1px solid rgba(43,80,160,0.3)", boxShadow:"0 -8px 60px rgba(0,0,0,0.6)",
            maxHeight:"90vh", display:"flex", flexDirection:"column" }}>

          <div className="h-1 shrink-0"
            style={{ background:"linear-gradient(90deg,transparent,#1B3A8C,#C49A28,transparent)" }} />
          <div className="flex justify-center pt-3 pb-1 sm:hidden shrink-0">
            <div className="w-10 h-1 rounded-full" style={{ background:"rgba(255,255,255,0.12)" }} />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 shrink-0">
            <div>
              <p className="font-display text-base tracking-wider" style={{ color:"var(--text-main)" }}>EXPORT PDF</p>
              <p className="text-xs mt-0.5" style={{ color:"var(--text-muted)" }}>Suivi sportif · 1 page par joueur · 30 jours</p>
            </div>
            {!isExporting && (
              <button onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-xs hover:opacity-70"
                style={{ border:"1px solid var(--border)", color:"var(--text-muted)" }}>✕</button>
            )}
          </div>
          <div className="mx-6 shrink-0" style={{ height:1, background:"var(--border)" }} />

          {/* Liste */}
          <div className="px-6 py-4 overflow-y-auto flex-1">
            <button onClick={toggleAll} disabled={isExporting}
              className="flex items-center gap-2 mb-4 text-xs hover:opacity-70"
              style={{ color:"var(--text-muted)" }}>
              <CB checked={selected.size===joueurs.length} />
              <span>Tout sélectionner ({joueurs.length})</span>
            </button>

            {masculin.length>0 && (
              <div className="mb-4">
                <p className="text-[10px] font-semibold tracking-widest uppercase mb-2"
                  style={{ color:"var(--text-muted)", opacity:0.6 }}>Pôle Masculin</p>
                <div className="grid grid-cols-2 gap-2">
                  {masculin.map(j => <JCB key={j.id} joueur={j} checked={selected.has(j.id)} disabled={isExporting} onToggle={() => toggle(j.id)} />)}
                </div>
              </div>
            )}
            {feminin.length>0 && (
              <div>
                <p className="text-[10px] font-semibold tracking-widest uppercase mb-2"
                  style={{ color:"var(--text-muted)", opacity:0.6 }}>Pôle Féminin</p>
                <div className="grid grid-cols-2 gap-2">
                  {feminin.map(j => <JCB key={j.id} joueur={j} checked={selected.has(j.id)} disabled={isExporting} onToggle={() => toggle(j.id)} />)}
                </div>
              </div>
            )}
          </div>

          {/* Progress */}
          {isExporting && (
            <div className="px-6 pb-2 shrink-0">
              <div className="flex justify-between text-xs mb-1.5" style={{ color:"var(--text-muted)" }}>
                <span>{status==="fetching"?"Récupération...":"Génération du PDF..."}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background:"rgba(255,255,255,0.06)" }}>
                <div className="h-full rounded-full transition-all duration-300"
                  style={{ width:`${progress}%`, background:"linear-gradient(90deg,#1B3A8C,#C49A28)" }} />
              </div>
            </div>
          )}

          {/* Bouton */}
          <div className="px-6 py-4 shrink-0">
            <button
              onClick={status==="error" ? ()=>setStatus("idle") : runExport}
              disabled={selected.size===0||isExporting||status==="done"}
              className="w-full py-3.5 rounded-xl font-display text-sm tracking-widest transition-all active:scale-[0.98]"
              style={{ background:btnBg, color:!selected.size&&!isExporting?"var(--text-muted)":"white",
                cursor:selected.size===0||isExporting?"not-allowed":"pointer",
                boxShadow:selected.size>0&&!isExporting?"0 4px 20px rgba(27,58,140,0.35)":"none" }}>
              {btnLabel}
            </button>
            <div className="h-4 sm:h-0" />
          </div>
        </div>
      </div>

      {/* Zone de rendu cachée */}
      <div ref={printRef} style={{ position:"fixed", left:"-9999px", top:0, pointerEvents:"none", zIndex:-1 }}>
        {datas.map(d => (
          <div key={d.joueur.id} data-print-page="true"><PlayerPrintPage data={d} /></div>
        ))}
      </div>
    </>
  );
}

function CB({ checked }: { checked: boolean }) {
  return (
    <div className="w-4 h-4 rounded flex items-center justify-center shrink-0"
      style={{ background:checked?"var(--primary)":"transparent",
        border:`1.5px solid ${checked?"var(--primary)":"var(--border)"}`, transition:"all 0.15s" }}>
      {checked && <span style={{ color:"white", fontSize:9, lineHeight:1 }}>✓</span>}
    </div>
  );
}
function JCB({ joueur, checked, disabled, onToggle }: { joueur: Joueuse; checked: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} disabled={disabled}
      className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all active:scale-[0.97]"
      style={{ background:checked?"rgba(27,58,140,0.15)":"rgba(255,255,255,0.03)",
        border:`1px solid ${checked?"rgba(43,80,160,0.4)":"rgba(255,255,255,0.06)"}` }}>
      <CB checked={checked} />
      <p className="text-sm font-medium truncate" style={{ color:checked?"var(--text-main)":"var(--text-muted)" }}>
        {joueur.prenom} {joueur.nom}
      </p>
    </button>
  );
}