import { parseEtsyListingSource, listingError } from "./listing-store.js";
import { downloadTrustedEtsyRaster } from "./listing-assets.js";
import { refreshEtsyAuthorization } from "./etsy-oauth.js";
import { markEtsyConnectionReconnectRequired } from "./etsy-connection-store.js";

export function normalizeListingSource(listing, etsyListingId, shopId, now = new Date()) {
  const facts = { listingId: etsyListingId, shopId: String(shopId), state: listing.state || null, retrievedAt: now.toISOString(), baseOffer: "Topper only; reel choices are manual Amazon customizations" };
  for (const key of ["materials", "item_length", "item_width", "item_height", "item_dimensions_unit", "is_personalizable", "personalization_instructions", "personalization_char_count_max"]) {
    if (listing[key] != null) facts[key] = listing[key];
  }
  return {
    sourceUrl: `https://www.etsy.com/listing/${etsyListingId}`,
    title: String(listing.title || ""), description: String(listing.description || ""), facts,
    warnings: ["Confirm product dimensions from the source description and structured measurements before approving copy.", "Apply the Amazon customization template manually; reel surcharges are separate from the topper-only base price."], images: [],
  };
}

export function recommendMainImage(images) {
  const score = (image) => {
    const alt = image.alt || "";
    const chart = /\b(chart|guide|sizes|colors|colours|instructions|font options|collage)\b/i.test(alt);
    const product = /\b(badge|reel|topper|product)\b/i.test(alt);
    const ratio = image.width / image.height;
    return (chart ? -100 : 0) + (product ? 10 : 0) + (Math.min(image.width, image.height) >= 1000 ? 5 : 0) + (ratio >= 0.7 && ratio <= 1.5 ? 3 : 0);
  };
  const best = [...images].sort((a, b) => score(b) - score(a) || a.sourceRank - b.sourceRank)[0];
  return images.map((image) => ({ ...image, main: image === best }));
}

export function createListingImportService({ getConnection, createClient, downloadImage = downloadTrustedEtsyRaster, refreshAccess = refreshEtsyAuthorization, markReconnect = markEtsyConnectionReconnectRequired, clock = () => new Date() } = {}) {
  if (typeof getConnection !== "function" || typeof createClient !== "function") throw new TypeError("getConnection and createClient are required");
  return { async importOwnedListing({ workspaceId, source, signal }) {
    const etsyListingId = parseEtsyListingSource(source);
    const connection = await getConnection({ workspaceId });
    if (!connection || connection.status !== "connected" || !connection.etsyShopId || !connection.accessToken) throw listingError(409, "Connect Etsy before importing a listing.");
    const budget = AbortSignal.timeout(45_000);
    const requestSignal = signal ? AbortSignal.any([signal, budget]) : budget;
    let token = connection.accessToken;
    try {
      if (Date.parse(connection.accessTokenExpiresAt) <= clock().getTime() + 300_000) {
        if (!connection.refreshToken) throw Object.assign(new Error(), { code: "reauthorize" });
        token = (await refreshAccess({ workspaceId, refreshToken: connection.refreshToken, now: clock() })).accessToken;
      }
      const client = createClient({ getAccessToken: async () => token });
      const listing = await client.getListing({ listingId: etsyListingId, signal: requestSignal });
      if (listing?.shop_id == null || String(listing.shop_id) !== String(connection.etsyShopId)) throw listingError(403, "That Etsy listing does not belong to the connected shop.");
      if (String(listing.listing_id) !== etsyListingId) throw listingError(502, "Etsy returned a different listing.");
      const images = await client.getListingImages({ listingId: etsyListingId, signal: requestSignal });
      const normalized = normalizeListingSource(listing, etsyListingId, connection.etsyShopId, clock());
      const candidates = (images || []).slice(0, 10);
      const downloaded = new Array(candidates.length);
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, async () => {
        while (cursor < candidates.length) {
          const sourceRank = cursor++;
          const image = candidates[sourceRank];
          const sourceUrl = image?.url_fullxfull || image?.url_570xN;
          try {
            if (requestSignal.aborted) throw new Error("Cancelled");
            downloaded[sourceRank] = { ...(await downloadImage({ sourceUrl, signal: requestSignal })), sourceRank, alt: String(image.alt_text || listing.title || "") };
          } catch { normalized.warnings.push(`Etsy image ${sourceRank + 1} could not be downloaded. Upload a replacement if needed.`); }
        }
      }));
      if (requestSignal.aborted) throw listingError(504, "Etsy import timed out. Please retry.");
      normalized.images = recommendMainImage(downloaded.filter(Boolean));
      normalized.warnings.push(normalized.images.length ? "Main photo is a suggestion based on image labels and dimensions. Check the product and choose a different photo if needed." : "No source images were downloaded. Upload replacement images before review.");
      return { etsyShopId: String(connection.etsyShopId), etsyListingId, source: normalized };
    } catch (error) {
      if (error?.code === "reauthorize" || error?.category === "reauthorize") {
        await markReconnect({ workspaceId });
        throw listingError(409, "Reconnect Etsy before importing a listing.");
      }
      if (error?.expose) throw error;
      throw listingError(requestSignal.aborted ? 504 : 502, requestSignal.aborted ? "Etsy import timed out. Please retry." : "Unable to retrieve this Etsy listing. Please retry.");
    }
  } };
}
