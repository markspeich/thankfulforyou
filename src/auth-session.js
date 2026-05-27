let browserSupabaseClient = null;

function readBrowserSupabaseClientOverride() {
  return globalThis.__TFU_TEST_SUPABASE_CLIENT__ ?? null;
}

function readBrowserSupabaseFactory() {
  const runtime = globalThis.supabase ?? null;

  if (typeof runtime?.createClient !== "function") {
    throw new Error(
      "Supabase browser runtime is missing. Load /node_modules/@supabase/supabase-js/dist/umd/supabase.js before shared queue auth.",
    );
  }

  return runtime.createClient;
}

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
  const override = readBrowserSupabaseClientOverride();
  if (override) {
    browserSupabaseClient = override;
    return browserSupabaseClient;
  }

  if (browserSupabaseClient) {
    return browserSupabaseClient;
  }

  const { url, anonKey } = readBrowserSupabaseConfig();
  const createClient = readBrowserSupabaseFactory();

  browserSupabaseClient = createClient(url, anonKey, {
    auth: {
      storageKey: "thankfulforyou.supabase.auth",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return browserSupabaseClient;
}

export async function signInWithPassword(email, password) {
  const client = getBrowserSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw error;
  }

  return data.session;
}

export async function signOutBrowserSession() {
  const client = getBrowserSupabaseClient();
  const { error } = await client.auth.signOut();

  if (error) {
    throw error;
  }
}

export function subscribeToAuthChanges(onChange) {
  const client = getBrowserSupabaseClient();
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    onChange(session);
  });

  return () => data.subscription.unsubscribe();
}

export async function getSignedInSession() {
  const client = getBrowserSupabaseClient();
  const { data, error } = await client.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session;
}

export async function getAccessToken() {
  const session = await getSignedInSession();
  return session?.access_token ?? null;
}
