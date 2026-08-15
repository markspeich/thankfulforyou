import { normalizeCustomerFontAlias } from "../../src/amazon-customer-fonts.js";
import { createSupabaseAdminClient } from "./supabase-admin.js";

export function createFontAliasStoreError(statusCode, code, message, expose = true) {
  return Object.assign(new Error(message), { statusCode, code, expose });
}

function mapFont(row, prefix = "font") {
  const id = row?.[`${prefix}_id`] ?? row?.id ?? null;
  if (!id) return null;
  return {
    id,
    displayName: row?.[`${prefix}_display_name`] ?? row?.display_name ?? null,
    archivedAt: row?.[`${prefix}_archived_at`] ?? row?.archived_at ?? null,
    deletedAt: row?.[`${prefix}_deleted_at`] ?? row?.deleted_at ?? null,
  };
}

function mapAliasRow(row) {
  if (!row) return null;
  const font = row.font_display_name !== undefined
    ? mapFont(row, "font")
    : mapFont(row.fonts || { id: row.font_id });
  return {
    id: row.id ?? row.alias_id ?? null,
    aliasName: row.alias_name ?? null,
    normalizedAlias: row.normalized_alias ?? null,
    fontId: row.font_id ?? null,
    revision: row.revision ?? row.alias_revision ?? null,
    font,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function mapSavedLine(line) {
  if (!line) return null;
  return {
    lineIndex: line.line_index ?? null,
    kind: line.item_kind === "fixed_svg" ? "fixedSvg" : "text",
    text: line.text ?? "",
    fontId: line.font_id ?? null,
    bridgeMm: line.letter_bridge_mm ?? null,
    lineBridgeMm: line.line_bridge_mm ?? null,
    offsetXMm: line.offset_x_mm ?? null,
    offsetYMm: line.offset_y_mm ?? null,
    fontSizeMm: line.text_height_mm ?? null,
    horizontalScale: line.horizontal_scale ?? null,
    verticalScale: line.vertical_scale ?? null,
    lockTextHeight: Boolean(line.lock_text_height),
    fixedDesignId: line.fixed_design_id ?? null,
    fixedDesignVersion: line.fixed_design_version ?? null,
    svgSizeMm: line.svg_size_mm ?? null,
    backingBorder: Boolean(line.fixed_svg_backing_border),
  };
}

function mapRpcResult(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.alias_id) {
    throw createFontAliasStoreError(500, "FONT_ALIAS_SAVE_FAILED", "Unable to save this font mapping.", false);
  }
  return {
    alias: mapAliasRow(row),
    previousFont: mapFont(row, "previous_font"),
    line: mapSavedLine(row.line),
    orderRevision: row.order_revision ?? null,
    designRevision: row.design_revision ?? null,
    designStateInvalidated: Boolean(row.design_state_invalidated),
    productionStatus: row.production_status ?? null,
  };
}

function mapRpcError(error) {
  if (error?.code === "40001" || error?.code === "23505") {
    return createFontAliasStoreError(409, "FONT_ALIAS_CONFLICT", "This mapping changed while you were editing it. Refresh and try again.");
  }
  if (error?.code === "42501") {
    return createFontAliasStoreError(403, "FONT_ALIAS_FORBIDDEN", "You do not have access to this workspace.");
  }
  if (error?.code === "22023" || error?.code === "23503" || error?.code === "23514") {
    return createFontAliasStoreError(400, "FONT_ALIAS_VALIDATION", error.message || "Alias mapping is invalid.");
  }
  return createFontAliasStoreError(500, "FONT_ALIAS_SAVE_FAILED", "Unable to save this font mapping.", false);
}

export async function listWorkspaceFontAliases({ workspaceId, supabase = createSupabaseAdminClient() }) {
  const { data, error } = await supabase
    .from("font_aliases")
    .select("id, alias_name, normalized_alias, font_id, revision, created_at, updated_at, fonts!inner(id, display_name, archived_at, deleted_at)")
    .eq("workspace_id", workspaceId)
    .order("alias_name", { ascending: true });
  if (error) throw error;
  return (data || []).map(mapAliasRow);
}

export async function mapWorkspaceFontAlias({
  workspaceId,
  userId,
  aliasName,
  fontId,
  orderItemId = null,
  designId = null,
  lineIndex = null,
  expectedAliasRevision = null,
  expectedOrderRevision = null,
  expectedDesignRevision = null,
  supabase = createSupabaseAdminClient(),
}) {
  const normalizedAlias = normalizeCustomerFontAlias(aliasName);
  if (!normalizedAlias) {
    throw createFontAliasStoreError(400, "FONT_ALIAS_VALIDATION", "Alias name is required.");
  }
  if (typeof fontId !== "string" || !fontId.trim()) {
    throw createFontAliasStoreError(400, "FONT_ALIAS_VALIDATION", "Select an active workspace font.");
  }

  const { data, error } = await supabase.rpc("map_workspace_font_alias", {
    p_workspace_id: workspaceId,
    p_user_id: userId,
    p_alias_name: aliasName,
    p_normalized_alias: normalizedAlias,
    p_font_id: fontId.trim(),
    p_order_item_id: orderItemId,
    p_design_id: designId,
    p_line_index: lineIndex,
    p_expected_alias_revision: expectedAliasRevision,
    p_expected_order_revision: expectedOrderRevision,
    p_expected_design_revision: expectedDesignRevision,
  });
  if (error) throw mapRpcError(error);
  return mapRpcResult(data);
}
