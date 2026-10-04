export function normalizeOrderColorUpdates(value = [], orderItemIds = []) {
  const fail = () => { throw Object.assign(new Error("Color updates require a saved item and either a non-empty set value or an explicit clear action."), { statusCode: 400, expose: true }); };
  if (!Array.isArray(value)) fail();
  const allowed = new Set(orderItemIds);
  const seen = new Set();
  return value.map(update => {
    if (!update || typeof update.orderItemId !== "string" || !allowed.has(update.orderItemId) || seen.has(update.orderItemId)) fail();
    seen.add(update.orderItemId);
    if (update.action === "clear" && !Object.hasOwn(update, "colorName")) return { orderItemId: update.orderItemId, action: "clear" };
    if (update.action !== "set" || typeof update.colorName !== "string" || !update.colorName.trim()) fail();
    return { orderItemId: update.orderItemId, action: "set", colorName: update.colorName.trim() };
  });
}
