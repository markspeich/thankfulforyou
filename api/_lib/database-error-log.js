// Server-log-only summary of the database error behind an application error.
// Store wrappers (for example AmazonImportStoreError) keep the Supabase/PostgREST
// error as `cause`; without this, logs show only the wrapper and the actual
// database reason (such as a raised RPC validation message) is lost.
//
// Only code, message, and hint are kept. PostgREST `details` is deliberately
// omitted because constraint errors put row values there ("Key (id)=(...)").
// Never return this to API clients; it is for operator debugging in server logs.

const MAX_MESSAGE_LENGTH = 300;
const MAX_HINT_LENGTH = 200;
const MAX_CAUSE_DEPTH = 5;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;
// SQLSTATE codes (23505, P0001, PT409, ...) and PostgREST codes (PGRST116, ...).
const DATABASE_ERROR_CODE = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/;

function read(value, key) {
  try { return value?.[key]; } catch { return undefined; }
}

function clean(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function isDatabaseError(value) {
  if (!value || typeof value !== "object") return false;
  const code = read(value, "code");
  const name = read(value, "name");
  // Node system errors such as EPIPE also have 5-letter codes; they carry syscall.
  if (read(value, "syscall") !== undefined) return false;
  return (typeof code === "string" && DATABASE_ERROR_CODE.test(code))
    || name === "PostgrestError";
}

export function databaseErrorCause(error) {
  let current = error;
  const seen = new Set();
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current && typeof current === "object"; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (isDatabaseError(current)) {
      const message = clean(read(current, "message"), MAX_MESSAGE_LENGTH);
      const code = clean(read(current, "code"), 16);
      const hint = clean(read(current, "hint"), MAX_HINT_LENGTH);
      if (!message && !code) return null;
      return {
        ...(code ? { code } : {}),
        ...(message ? { message } : {}),
        ...(hint ? { hint } : {}),
      };
    }
    current = read(current, "cause");
  }
  return null;
}

// Convenience for console.error call sites: an object to spread into log metadata.
export function databaseErrorLogFields(error) {
  const databaseError = databaseErrorCause(error);
  return databaseError ? { databaseError } : {};
}

// For positional console.error call sites: no extra argument unless there is a database cause.
export function databaseErrorLogArgs(error) {
  const databaseError = databaseErrorCause(error);
  return databaseError ? [{ databaseError }] : [];
}
