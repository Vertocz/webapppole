"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabase } from "@/lib/supabase";

export default function HomePage() {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const normalizePhone = (val: string) => val.replace(/\s/g, "").replace(/^\+33/, "0");

  const handleAccess = async () => {
    setError("");
    const numero = normalizePhone(phone);
    if (numero.length !== 10 || !["06", "07"].some((p) => numero.startsWith(p))) {
      setError("Numéro invalide. Entrez un numéro français (06 ou 07, 10 chiffres).");
      return;
    }
    setLoading(true);
    try {
      const { data: joueuses } = await supabase.from("joueuses").select("*").eq("numero_tel", numero);
      if (joueuses && joueuses.length > 0) {
        sessionStorage.setItem("user", JSON.stringify(joueuses[0]));
        sessionStorage.setItem("type_user", "joueuse");
        router.push("/player"); return;
      }
      const { data: staff } = await supabase.from("staff").select("*").eq("numero_tel", numero);
      if (staff && staff.length > 0) {
        sessionStorage.setItem("user", JSON.stringify(staff[0]));
        sessionStorage.setItem("type_user", "staff");
        router.push("/staff"); return;
      }
      setError("Numéro inconnu. Veuillez contacter votre encadrant.");
    } catch {
      setError("Erreur de connexion. Réessayez.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      className="relative min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ background: "#05080F" }}
    >
      {/* Ambient glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1" style={{ background: "linear-gradient(90deg, #1B3A8C, #E8192C, #1B3A8C)" }} />
        <div className="absolute" style={{ top: "10%", left: "-20%", width: "50vw", height: "50vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(27,58,140,0.12) 0%, transparent 70%)" }} />
        <div className="absolute" style={{ bottom: "10%", right: "-15%", width: "40vw", height: "40vw", borderRadius: "50%", background: "radial-gradient(circle, rgba(232,25,44,0.06) 0%, transparent 70%)" }} />
        <div className="absolute" style={{ top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "min(80vw, 500px)", height: "min(80vw, 500px)", borderRadius: "50%", border: "1px solid rgba(27,58,140,0.08)" }} />
        <div className="absolute" style={{ top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "min(60vw, 380px)", height: "min(60vw, 380px)", borderRadius: "50%", border: "1px solid rgba(27,58,140,0.06)" }} />
      </div>

      <div className="w-full max-w-sm relative z-10 animate-fade-in-up">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-28 h-28 rounded-2xl mb-6 shadow-2xl"
            style={{ background: "white", padding: "10px", boxShadow: "0 0 40px rgba(27,58,140,0.2), 0 20px 40px rgba(0,0,0,0.4)" }}>
            <Image src="/logo.png" alt="Pôle France Para Basketball Adapté" width={96} height={96} style={{ objectFit: "contain" }} priority />
          </div>
          <div className="space-y-1">
            <h1 className="font-display text-4xl leading-none" style={{ color: "#E8EEF8", letterSpacing: "0.04em" }}>
              PÔLE FRANCE
            </h1>
            <div className="flex items-center justify-center gap-2">
              <div className="h-px flex-1" style={{ background: "linear-gradient(90deg, transparent, #1B3A8C)" }} />
              <p className="text-xs tracking-[0.25em] uppercase font-light" style={{ color: "#6B82B0" }}>
                Para Basketball Adapté
              </p>
              <div className="h-px flex-1" style={{ background: "linear-gradient(90deg, #1B3A8C, transparent)" }} />
            </div>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-7"
          style={{
            background: "linear-gradient(145deg, #0B1120, #0E1628)",
            border: "1px solid rgba(43,80,160,0.2)",
            boxShadow: "0 25px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(43,80,160,0.12)",
          }}>
          <div className="h-0.5 rounded-full mb-6" style={{ background: "linear-gradient(90deg, #1B3A8C, #E8192C)" }} />

          <h2 className="font-display text-2xl mb-1" style={{ color: "#E8EEF8" }}>ACCÈS MEMBRE</h2>
          <p className="text-sm mb-6" style={{ color: "#3D5080" }}>
            Entrez votre numéro pour accéder à votre espace.
          </p>

          <div className="space-y-4">
            <div>
              <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6B82B0", marginBottom: "0.5rem" }}>
                Numéro de téléphone
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAccess()}
                placeholder="06 12 34 56 78"
                className="w-full px-4 py-3 rounded-xl text-lg font-light outline-none transition-all"
                style={{ background: "#060A14", border: "1px solid rgba(43,80,160,0.2)", color: "#E8EEF8" }}
                autoFocus
              />
            </div>

            {error && (
              <div className="rounded-lg px-4 py-3 text-sm animate-slide-in"
                style={{ background: "rgba(232,25,44,0.1)", border: "1px solid rgba(232,25,44,0.25)", color: "#FF8090" }}>
                {error}
              </div>
            )}

            <button
              onClick={handleAccess}
              disabled={loading || !phone}
              className="w-full py-3.5 rounded-xl font-display text-lg tracking-widest transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: loading ? "#0B1120" : "linear-gradient(135deg, #1B3A8C, #2952CC)",
                color: loading ? "#3D5080" : "white",
                boxShadow: loading ? "none" : "0 4px 24px rgba(27,58,140,0.4)",
                borderTop: "1px solid rgba(255,255,255,0.08)",
              }}
              onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
            >
              {loading ? "Vérification..." : "ACCÉDER"}
            </button>
          </div>
        </div>

        <p className="text-center text-xs mt-6 font-light" style={{ color: "rgba(43,80,160,0.4)" }}>
          Application créée avec amour par votre Chargé de Vie Quotidienne. N&apos;hésitez pas à le contacter pour toute question ou suggestion !
        </p>
      </div>
    </main>
  );
}
