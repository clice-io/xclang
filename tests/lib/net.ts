/// fetch, tried again when the network fails: a 5xx or 429, or no answer
/// (a connection timed out or reset), after 15 s, 45 s, 90 s and 180 s. A
/// 4xx but 429 is the answer, returned at once.

const WAITS = [15, 45, 90, 180];

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
