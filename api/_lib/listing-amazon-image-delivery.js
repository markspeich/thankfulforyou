import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { validateRasterBytes } from "./listing-assets.js";

export const AMAZON_IMAGE_BUCKET = "amazon-listing-delivery";
const fail = message => Object.assign(new Error(message), { statusCode: 409, expose: true });
export function hasAmazonImageDeliveryConfig(env = process.env) {
  return /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(env.AMAZON_IMAGE_STORAGE_URL || "") && Boolean(env.AMAZON_IMAGE_STORAGE_SERVICE_ROLE_KEY?.trim());
}
export function createAmazonImageDelivery({ env = process.env, source = null, destination = null } = {}) {
  const configured = () => Boolean(destination) || hasAmazonImageDeliveryConfig(env);
  return {
    configured,
    async prepare({ workspaceId, draft }) {
      if (!configured()) throw fail("Configure cloud image storage before production validation. Local image URLs cannot be fetched by Amazon.");
      const deadline = AbortSignal.timeout(60000);
      const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, options) => fetch(url, { ...options, signal: deadline }) } };
      const local = source || createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options);
      const cloud = destination || createClient(env.AMAZON_IMAGE_STORAGE_URL, env.AMAZON_IMAGE_STORAGE_SERVICE_ROLE_KEY, options);
      const selected = draft.images.filter(image => image.selected);
      if (!selected.length || selected.length > 9 || selected.some(image => !image.approved)) throw fail("Select and approve up to nine images before production validation.");
      const { data: assets, error } = await local.from("listing_assets").select("*").eq("workspace_id", workspaceId).eq("draft_id", draft.id).in("id", selected.map(image => image.id));
      if (error || !assets || assets.length !== selected.length) throw fail("Unable to read the approved images. Reload the draft and try again.");
      const urls = new Map();
      for (const image of selected) {
        const asset = assets.find(asset => asset.id === image.id);
        if (!asset || !asset.selected || !asset.approved) throw fail("Image approval changed. Reload and review the draft.");
        const { data, error: downloadError } = await local.storage.from(asset.storage_bucket).download(asset.storage_path);
        if (downloadError || !data || data.size > 10 * 1024 * 1024) throw fail("Unable to read an approved image for Amazon delivery.");
        const raster = validateRasterBytes({ bytes: Buffer.from(await data.arrayBuffer()), mimeType: asset.mime_type });
        const hash = createHash("sha256").update(raster.bytes).digest("hex");
        const path = `${workspaceId}/${draft.id}/${hash}.${raster.extension}`;
        const bucket = cloud.storage.from(AMAZON_IMAGE_BUCKET);
        const { error: uploadError } = await bucket.upload(path, raster.bytes, { contentType: raster.mimeType, upsert: false, cacheControl: "604800" });
        if (uploadError && !["409", "Duplicate"].includes(String(uploadError.statusCode || uploadError.code))) throw fail("Unable to stage approved images in cloud storage. Check the delivery bucket migration, credentials, and storage quota.");
        const { data: signed, error: signError } = await bucket.createSignedUrl(path, 7 * 24 * 60 * 60);
        if (signError || !signed?.signedUrl) throw fail("Unable to create an Amazon image download link. Check cloud storage configuration.");
        urls.set(image.id, signed.signedUrl);
      }
      return { ...draft, images: draft.images.map(image => urls.has(image.id) ? { ...image, url: urls.get(image.id) } : image) };
    },
  };
}
