export function buildApiQuery(requestUrl) {
  return Object.fromEntries(requestUrl.searchParams.entries());
}
