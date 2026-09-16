import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnvFile } from "./env_file.mjs";

const SOURCES = {
  "etsy.env": ["ETSY_API_KEY_KEYSTRING","ETSY_API_SHARED_SECRET","ETSY_TOKEN_ENCRYPTION_KEY","ETSY_REDIRECT_URI"],
  "amazon-sp-api.sandbox.env": ["AMAZON_SP_API_ENVIRONMENT","AMAZON_SP_API_CLIENT_ID","AMAZON_SP_API_CLIENT_SECRET","AMAZON_SP_API_REFRESH_TOKEN"],
  "listing-providers.env": ["LISTING_OPENAI_API_KEY","LISTING_OPENAI_MODEL","LISTING_OPENAI_IMAGE_MODEL"],
};
export function loadListingServiceEnv({cwd=process.cwd(),env=process.env}={}) {
  const result={...env};
  for(const [filename,keys] of Object.entries(SOURCES)) {
    const path=join(cwd,".local",filename);
    if(!existsSync(path)) continue;
    const values=parseEnvFile(readFileSync(path,"utf8"));
    for(const key of keys) if(!result[key] && values[key]) result[key]=values[key];
  }
  const productionPath = join(cwd, ".local", "amazon-sp-api.production.env");
  if (existsSync(productionPath)) {
    const values = parseEnvFile(readFileSync(productionPath, "utf8"));
    if (values.AMAZON_SP_API_ENVIRONMENT === "production") {
      for (const suffix of ["CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN", "SELLER_ID"]) {
        const target = "AMAZON_PRODUCTION_" + suffix;
        if (!result[target] && values["AMAZON_SP_API_" + suffix]) result[target] = values["AMAZON_SP_API_" + suffix];
      }
    }
  }
  const storagePath = join(cwd, ".local", "amazon-image-storage.env");
  if (existsSync(storagePath)) {
    const values = parseEnvFile(readFileSync(storagePath, "utf8"));
    for (const key of ["AMAZON_IMAGE_STORAGE_URL", "AMAZON_IMAGE_STORAGE_SERVICE_ROLE_KEY"]) if (!result[key] && values[key]) result[key] = values[key];
  }
  return result;
}
