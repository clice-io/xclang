/// Downloads tried again when the network fails, not the request: GitHub's
/// 5xx (release downloads, its API), timeouts, connections reset; after
/// 15 s, 45 s, 90 s and 180 s, five tries in about six minutes, longer than
/// GitHub's usual blips. A command's (tests/lib/retry.ts, gh) by what it
/// prints, fetch's by its status.

export const WAITS = [15, 45, 90, 180];

/// What a failure's output says when the network, not the request, failed.
export const TRANSIENT = new RegExp([
  String.raw`\bHTTP[/ ]?(?:[\d.]+ )?5\d\d\b`, String.raw`\b50[0234]\b.*(?:Error|Gateway|Unavailable|Timeout)`,
  "Service Unavailable", "Bad Gateway", "Gateway Time-?out", "Internal Server Error",
  "timed? ?out", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND", "socket hang up",
  "connection reset", "unexpected EOF", "TLS handshake", "Could not resolve host", "fetch failed",
  "secondary rate limit", "API rate limit exceeded", "early EOF", "RPC failed",
].join("|"), "i");

/// fetch, tried again on a 5xx or 429, or no answer. A 4xx but 429 is the
/// answer, returned at once.
export async function fetchRetry(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = { "User-Agent": "xclang/ci", ...(init.headers as Record<string, string> | undefined) };
  for (let attempt = 1; ; attempt++) {
    const wait = WAITS[attempt - 1];
    try {
      const response = await fetch(url, { ...init, headers });
      if (response.ok || wait === undefined || (response.status < 500 && response.status !== 429)) return response;
      console.error(`${url}: HTTP ${response.status} (try ${attempt}); again in ${wait} s`);
    } catch (error) {
      if (wait === undefined) throw error;
      const cause = error instanceof Error ? `${error.message}${error.cause ? `: ${String(error.cause)}` : ""}` : String(error);
      console.error(`${url}: ${cause} (try ${attempt}); again in ${wait} s`);
    }
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}
