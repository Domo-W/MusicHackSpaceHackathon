import { CONFIG } from "./config.js";

export interface GenOpts {
  lyrics: string;
  style: string;
  title: string;
  voiceId?: string;
  instrumental?: boolean;
}

export interface SunoStatus {
  id: string;
  status: "submitted" | "queued" | "streaming" | "complete" | "error" | string;
  audioUrl: string; // "" until streaming/complete
  error: string | null;
}

async function sunoFetch(path: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  const res = await fetch(`${CONFIG.sunoBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CONFIG.sunoApiKey}`,
      "Content-Type": "application/json",
      // Cloudflare 1010 blocks default Node/undici UA — must send a real one.
      "User-Agent": CONFIG.userAgent,
      ...(init.headers ?? {}),
    },
  });
  // retry transient 429/5xx with backoff
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await delay(400 * 2 ** attempt);
    return sunoFetch(path, init, attempt + 1);
  }
  return res;
}

async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return "";
  }
}

/** Submit a Custom-mode generation; returns the clip id. */
export async function submitGeneration(opts: GenOpts): Promise<string> {
  const body: Record<string, unknown> = { style: opts.style, title: opts.title };
  if (opts.instrumental) body.instrumental = true;
  else body.lyrics = opts.lyrics;
  if (opts.voiceId) body.voice_id = opts.voiceId;

  const res = await sunoFetch("/v0/audio", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Suno generate ${res.status}: ${await safeBody(res)}`);
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error(`Suno generate: no id in response`);
  return data.id;
}

/** One status poll. */
export async function getStatus(id: string): Promise<SunoStatus> {
  const res = await sunoFetch(`/v0/audio/${id}`);
  if (!res.ok) throw new Error(`Suno poll ${res.status}: ${await safeBody(res)}`);
  const d = (await res.json()) as { id: string; status: string; audio_url?: string; error?: string | null };
  return { id: d.id, status: d.status, audioUrl: d.audio_url || "", error: d.error ?? null };
}

export interface GenerateResult {
  playableUrl: string; // first usable audio_url (streaming or complete)
  finalUrl: string; // complete CDN url
  msToPlayable: number;
  msToComplete: number;
}

/**
 * Submit + poll. Calls onPlayable as soon as an audio_url appears (so the engine
 * can pre-buffer/start), then resolves when status === "complete".
 */
export async function generateSong(
  opts: GenOpts,
  cb: { onPlayable?: (url: string, status: string) => void; signal?: AbortSignal } = {},
): Promise<GenerateResult> {
  const t0 = Date.now();
  const id = await submitGeneration(opts);
  let playableUrl = "";
  let msToPlayable = 0;

  while (true) {
    if (cb.signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (Date.now() - t0 > CONFIG.maxGenWaitMs) throw new Error(`Suno timed out for ${id}`);

    const s = await getStatus(id);
    if (s.status === "error") throw new Error(`Suno error for ${id}: ${s.error ?? "unknown"}`);

    if (s.audioUrl && !playableUrl) {
      playableUrl = s.audioUrl;
      msToPlayable = Date.now() - t0;
      cb.onPlayable?.(s.audioUrl, s.status);
    }
    if (s.status === "complete") {
      return {
        playableUrl: playableUrl || s.audioUrl,
        finalUrl: s.audioUrl,
        msToPlayable: msToPlayable || Date.now() - t0,
        msToComplete: Date.now() - t0,
      };
    }
    await delay(CONFIG.pollIntervalMs);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
