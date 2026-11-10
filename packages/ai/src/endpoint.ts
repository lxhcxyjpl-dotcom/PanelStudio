const COMPLETIONS_PATH = "/chat/completions";

/**
 * baseUrl is a prefix. The adapter appends /chat/completions exactly once.
 * A prefix that already ends with that segment is not appended twice.
 * Query strings, fragments, and URL credentials are not forwarded.
 */
export function chatCompletionsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  let path = url.pathname.replace(/\/+$/u, "");
  if (path.endsWith(COMPLETIONS_PATH)) {
    path = path.slice(0, -COMPLETIONS_PATH.length).replace(/\/+$/u, "");
  }
  url.pathname = `${path}${COMPLETIONS_PATH}`;
  url.search = "";
  url.hash = "";
  url.username = "";
  url.password = "";
  return url.href;
}

export function endpointProblem(baseUrl: string, allowLocalEndpoint: boolean): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return "The provider URL is invalid.";
  }
  if (url.username || url.password) {
    return "The provider URL cannot contain credentials.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "The provider URL must use HTTP or HTTPS.";
  }
  const local = isLocalHostname(url.hostname);
  if (local) {
    return allowLocalEndpoint ? null : "Local provider addresses require allowLocalEndpoint.";
  }
  if (url.protocol !== "https:") {
    return "Remote provider addresses require HTTPS.";
  }
  return null;
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (host === "localhost" || host === "::1" || host === "0.0.0.0" || host.endsWith(".local")) return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  if (!match) return false;
  const parts = match.slice(1).map((part) => Number(part));
  if (parts.some((part) => part > 255)) return false;
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  return a === 172 && b >= 16 && b <= 31;
}
