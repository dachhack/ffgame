// One JSON fetch for the sport feeds: browser-shaped headers (cdn.nba.com
// and cdn.wnba.com refuse a bare client), a timeout, and bounded retries
// with backoff on network errors and 5xx/429. A 4xx other than 429 is not
// retried — it is the feed saying no, and a poller should log and move on.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

export async function getJson(url, { tries = 3, timeoutMs = 15000, headers = {} } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ac.signal, redirect: 'follow',
        headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9', ...headers },
      });
      if (res.ok) return await res.json();
      lastErr = new Error(`${res.status} ${url}`);
      if (res.status < 500 && res.status !== 429) throw lastErr;
    } catch (e) {
      lastErr = e;
      if (e?.message?.startsWith('4')) throw e;
    } finally {
      clearTimeout(t);
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  throw lastErr;
}
