import { createClient } from "@supabase/supabase-js";

let browserSupabaseClient = null;

function readBrowserSupabaseConfig() {
  const windowConfig = typeof window !== "undefined" ? window.__APP_CONFIG__ : null;
  const appConfig = windowConfig ?? globalThis.__APP_CONFIG__ ?? null;
  const url = appConfig?.supabaseUrl;
  const anonKey = appConfig?.supabaseAnonKey;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase browser config is missing. Set window.__APP_CONFIG__.supabaseUrl and window.__APP_CONFIG__.supabaseAnonKey before loading shared sessions.",
    );
  }

  return { url, anonKey };
}

export function getBrowserSupabaseClient() {
  if (browserSupabaseClient) {
    return browserSupabaseClient;
  }

  const { url, anonKey } = readBrowserSupabaseConfig();

  browserSupabaseClient = createClient(url, anonKey);
  return browserSupabaseClient;
}

export async function getSignedInSession() {
  const client = getBrowserSupabaseClient();
  const { data, error } = await client.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session;
}
