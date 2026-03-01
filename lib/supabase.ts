import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://fxvotvtapcwzvjhfreqv.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4dm90dnRhcGN3enZqaGZyZXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5ODU0MzMsImV4cCI6MjA3NzU2MTQzM30.-GHrLdGYicmtN2lx8MYkQlrnWKcxrcARp_tY6Cno3RQ";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
