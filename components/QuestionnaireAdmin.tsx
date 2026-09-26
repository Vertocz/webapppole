"use client";

/**
 * QuestionnaireAdmin.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Panneau admin pour créer des questionnaires ciblés (texte libre uniquement)
 * et consulter les réponses reçues, par joueuse ou par question.
 *
 * À monter dans l'onglet Admin, réservé aux staffs du pôle féminin :
 *   {user.feminin && <QuestionnaireAdmin staffId={user.id} />}
 *
 * Tables Supabase requises : voir questionnaires_schema.sql
 */

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const accent = "#E8641C";

interface Joueuse {
  id: string;
  prenom: string;
  nom: string;
  categorie?: string;
}

interface QuestionnaireRow {
  id: string;
  titre: string;
  questions: string[];
}