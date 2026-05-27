function readFirstDefinedEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function readPublicAppConfig() {
  return {
    supabaseUrl: readFirstDefinedEnv(["SUPABASE_URL"]),
    supabaseAnonKey: readFirstDefinedEnv(["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"]),
  };
}

export function buildPublicAppConfigScript() {
  const config = readPublicAppConfig();

  return [
    "window.__APP_CONFIG__ = Object.assign({}, window.__APP_CONFIG__ || {}, ",
    JSON.stringify(config),
    ");\n",
  ].join("");
}
