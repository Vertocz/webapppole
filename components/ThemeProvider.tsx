"use client";

import { useEffect } from "react";

export default function ThemeProvider({ theme }: { theme: "joueur" | "staff" | "login" }) {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    return () => document.documentElement.removeAttribute("data-theme");
  }, [theme]);
  return null;
}
