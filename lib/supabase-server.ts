import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getSupabaseDashboardConfig(): {
  supabaseUrl: string | undefined;
  supabaseServiceRoleKey: string | undefined;
} {
  return {
    supabaseUrl: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
}

export function hasSupabaseDashboardConfig(): boolean {
  const { supabaseUrl, supabaseServiceRoleKey } = getSupabaseDashboardConfig();
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

export function createSupabaseExpenseClient(): SupabaseClient {
  const { supabaseUrl, supabaseServiceRoleKey } = getSupabaseDashboardConfig();
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Supabase dashboard configuration is missing.");
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
