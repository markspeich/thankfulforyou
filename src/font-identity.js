export function buildWorkspaceFontFamily(fontId) {
  const id = String(fontId);
  const encodedId = Array.from(new TextEncoder().encode(id), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `WorkspaceFont_${encodedId}`;
}
