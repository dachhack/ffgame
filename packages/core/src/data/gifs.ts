// GIF search (0182.4) — one picker, two possible providers, chosen by
// whichever key the build carries: Tenor v2 (a Google Cloud API key) wins,
// else Giphy (the founder's existing key from the picks app), else the
// picker hides entirely and pasted GIF links still render inline.
//
// These keys ship inside the client bundle by nature (both providers design
// for that), so they are configuration, not secrets. Giphy's terms want the
// "Powered by GIPHY" marking — the attribution string is part of the
// provider, not decoration.

export interface GifResult { id: string; tiny: string; full: string; }

export interface GifProvider {
  name: 'tenor' | 'giphy';
  attribution: string;
  /** Empty query = the provider's featured/trending set. */
  search: (q: string) => Promise<GifResult[]>;
}

export function gifProvider(tenorKey?: string, giphyKey?: string): GifProvider | null {
  if (tenorKey) {
    return {
      name: 'tenor',
      attribution: 'via Tenor',
      search: async (q: string) => {
        const base = q.trim()
          ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q.trim())}`
          : 'https://tenor.googleapis.com/v2/featured?';
        const d = await fetch(`${base}&key=${tenorKey}&limit=12&media_filter=gif,tinygif`)
          .then((r) => r.json()) as { results?: { id: string; media_formats?: Record<string, { url?: string }> }[] };
        return (d.results ?? []).map((g) => ({
          id: g.id,
          tiny: g.media_formats?.tinygif?.url ?? g.media_formats?.gif?.url ?? '',
          full: g.media_formats?.gif?.url ?? g.media_formats?.tinygif?.url ?? '',
        })).filter((g) => g.tiny && g.full);
      },
    };
  }
  if (giphyKey) {
    return {
      name: 'giphy',
      attribution: 'Powered by GIPHY',
      search: async (q: string) => {
        const base = q.trim()
          ? `https://api.giphy.com/v1/gifs/search?q=${encodeURIComponent(q.trim())}&`
          : 'https://api.giphy.com/v1/gifs/trending?';
        const d = await fetch(`${base}api_key=${giphyKey}&limit=12&rating=pg-13`)
          .then((r) => r.json()) as { data?: { id: string; images?: Record<string, { url?: string }> }[] };
        return (d.data ?? []).map((g) => ({
          id: g.id,
          tiny: g.images?.fixed_width_small?.url ?? g.images?.fixed_width?.url ?? '',
          full: g.images?.fixed_width?.url ?? g.images?.original?.url ?? '',
        })).filter((g) => g.tiny && g.full);
      },
    };
  }
  return null;
}
