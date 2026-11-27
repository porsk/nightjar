import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import { extname, join } from 'node:path';

export type CloudVendorId = 'soniox' | 'elevenlabs' | 'gladia';
export type Fetch = typeof fetch;
export type Price = { perHour: number; currency: 'USD' | 'EUR' };

export type CloudOutcome = {
  text: string;
  /** Wall time of upload, job, transcript fetch and the delete calls. */
  seconds: number;
  /** One entry per delete call that failed. Empty means everything was removed. */
  deleteProblems: string[];
};

export type CloudVendor = {
  id: CloudVendorId;
  label: string;
  keyEnv: string;
  price: Price;
  /** Gladia does not list webm, so its clips are remuxed to ogg (stream copy, no re-encode). */
  acceptsWebm: boolean;
  transcribe: (audio: Blob, language: string, key: string, fetchFn: Fetch, poll: PollOptions) => Promise<Omit<CloudOutcome, 'seconds'>>;
};

export type PollOptions = { intervalMs: number; timeoutMs: number };

const UPLOAD_NAME = 'audio';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const failure = async (what: string, response: Response) => {
  const body = (await response.text().catch(() => '')).slice(0, 200);
  return new Error(`${what} failed: HTTP ${response.status} ${body}`);
};

const ok = async (what: string, response: Response) => {
  if (!response.ok) throw await failure(what, response);
  return response;
};

const pollUntil = async <T>(what: string, poll: PollOptions, read: () => Promise<{ done: boolean; value?: T }>): Promise<T> => {
  const deadline = Date.now() + poll.timeoutMs;
  for (;;) {
    const state = await read();
    if (state.done) return state.value as T;
    if (Date.now() > deadline) throw new Error(`${what} timed out`);
    await sleep(poll.intervalMs);
  }
};

/** Runs a delete call and turns any failure into a message instead of throwing, so one failure never hides the others. */
export const tryDelete = async (what: string, call: () => Promise<Response>, okStatuses: number[]): Promise<string | undefined> => {
  try {
    const response = await call();
    return okStatuses.includes(response.status) ? undefined : `${what}: HTTP ${response.status}`;
  } catch (error) {
    return `${what}: ${(error as Error).message}`;
  }
};

export const estimateCost = (audioSeconds: number, price: Price) => (audioSeconds / 3600) * price.perHour;

// Soniox. https://docs.soniox.com/stt/async/async-transcription
const SONIOX = 'https://api.soniox.com/v1';
export const SONIOX_MODEL = 'stt-async-v6';

export const sonioxCreateBody = (fileId: string) => ({ model: SONIOX_MODEL, file_id: fileId, language_hints: ['hu', 'en'] });
export const parseSonioxFile = (json: any): string => json.id;
export const parseSonioxStatus = (json: any): { status: string; error?: string } => ({ status: json.status, error: json.error_message ?? undefined });
export const parseSonioxTranscript = (json: any): string => String(json.text ?? '').trim();

const soniox: CloudVendor['transcribe'] = async (audio, _language, key, fetchFn, poll) => {
  const auth = { Authorization: `Bearer ${key}` };
  const form = new FormData();
  form.append('file', audio, UPLOAD_NAME);
  const fileId = parseSonioxFile(await (await ok('soniox upload', await fetchFn(`${SONIOX}/files`, { method: 'POST', headers: auth, body: form }))).json());
  let transcriptionId: string | undefined;
  const deleteProblems: string[] = [];
  try {
    const created = await ok(
      'soniox create',
      await fetchFn(`${SONIOX}/transcriptions`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(sonioxCreateBody(fileId)),
      }),
    );
    transcriptionId = (await created.json()).id as string;
    await pollUntil('soniox transcription', poll, async () => {
      const state = parseSonioxStatus(await (await ok('soniox status', await fetchFn(`${SONIOX}/transcriptions/${transcriptionId}`, { headers: auth }))).json());
      if (state.status === 'error') throw new Error(`soniox transcription error: ${state.error ?? 'unknown'}`);
      return { done: state.status === 'completed' };
    });
    const text = parseSonioxTranscript(await (await ok('soniox transcript', await fetchFn(`${SONIOX}/transcriptions/${transcriptionId}/transcript`, { headers: auth }))).json());
    return { text, deleteProblems: await deleteSoniox(fetchFn, auth, fileId, transcriptionId) };
  } catch (error) {
    deleteProblems.push(...(await deleteSoniox(fetchFn, auth, fileId, transcriptionId)));
    if (deleteProblems.length > 0) console.error(`soniox cleanup problems: ${deleteProblems.join('; ')}`);
    throw error;
  }
};

const deleteSoniox = async (fetchFn: Fetch, auth: Record<string, string>, fileId: string, transcriptionId?: string) => {
  const problems = [
    transcriptionId && (await tryDelete('soniox delete transcription', () => fetchFn(`${SONIOX}/transcriptions/${transcriptionId}`, { method: 'DELETE', headers: auth }), [204])),
    await tryDelete('soniox delete file', () => fetchFn(`${SONIOX}/files/${fileId}`, { method: 'DELETE', headers: auth }), [204]),
  ];
  return problems.filter((problem): problem is string => Boolean(problem));
};

// ElevenLabs Scribe. https://elevenlabs.io/docs/api-reference/speech-to-text/convert
const ELEVENLABS = 'https://api.elevenlabs.io/v1';
export const ELEVENLABS_MODEL = 'scribe_v3';

export const elevenLabsFields = (language: string) => ({ model_id: ELEVENLABS_MODEL, language_code: language, tag_audio_events: 'false' });
export const parseElevenLabs = (json: any): { text: string; transcriptionId?: string } => ({
  text: String(json.text ?? '').trim(),
  transcriptionId: json.transcription_id ?? undefined,
});

const elevenlabs: CloudVendor['transcribe'] = async (audio, language, key, fetchFn) => {
  const auth = { 'xi-api-key': key };
  const form = new FormData();
  for (const [name, value] of Object.entries(elevenLabsFields(language))) form.append(name, value);
  form.append('file', audio, UPLOAD_NAME);
  const { text, transcriptionId } = parseElevenLabs(await (await ok('elevenlabs convert', await fetchFn(`${ELEVENLABS}/speech-to-text`, { method: 'POST', headers: auth, body: form }))).json());
  const deleteProblems: string[] = [];
  if (transcriptionId) {
    const problem = await tryDelete('elevenlabs delete transcript', () => fetchFn(`${ELEVENLABS}/speech-to-text/transcripts/${transcriptionId}`, { method: 'DELETE', headers: auth }), [200]);
    if (problem) deleteProblems.push(problem);
  } else {
    deleteProblems.push('elevenlabs delete transcript: response had no transcription_id');
  }
  return { text, deleteProblems };
};

// Gladia pre-recorded v2. https://docs.gladia.io/chapters/pre-recorded-stt/getting-started
const GLADIA = 'https://api.gladia.io/v2';
export const GLADIA_MODEL = 'solaria-1';

export const gladiaCreateBody = (audioUrl: string, language: string) => ({ audio_url: audioUrl, model: GLADIA_MODEL, language_config: { languages: [language] } });
export const parseGladiaUpload = (json: any): string => json.audio_url;
export const parseGladiaStatus = (json: any): { status: string; error?: string } => ({ status: json.status, error: json.error_code != null ? String(json.error_code) : undefined });
export const parseGladiaResult = (json: any): string => String(json.result?.transcription?.full_transcript ?? '').trim();

const gladia: CloudVendor['transcribe'] = async (audio, language, key, fetchFn, poll) => {
  const auth = { 'x-gladia-key': key };
  const form = new FormData();
  form.append('audio', audio, UPLOAD_NAME);
  const audioUrl = parseGladiaUpload(await (await ok('gladia upload', await fetchFn(`${GLADIA}/upload`, { method: 'POST', headers: auth, body: form }))).json());
  let jobId: string | undefined;
  const cleanup = async () =>
    jobId ? [await tryDelete('gladia delete job', () => fetchFn(`${GLADIA}/pre-recorded/${jobId}`, { method: 'DELETE', headers: auth }), [202])].filter((p): p is string => Boolean(p)) : ['gladia delete job: no job was created, the uploaded file cannot be deleted'];
  try {
    const created = await ok(
      'gladia create',
      await fetchFn(`${GLADIA}/pre-recorded`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(gladiaCreateBody(audioUrl, language)),
      }),
    );
    jobId = (await created.json()).id as string;
    const text = await pollUntil('gladia job', poll, async () => {
      const json = await (await ok('gladia status', await fetchFn(`${GLADIA}/pre-recorded/${jobId}`, { headers: auth }))).json();
      const state = parseGladiaStatus(json);
      if (state.status === 'error') throw new Error(`gladia job error: ${state.error ?? 'unknown'}`);
      return state.status === 'done' ? { done: true, value: parseGladiaResult(json) } : { done: false };
    });
    return { text, deleteProblems: await cleanup() };
  } catch (error) {
    const problems = await cleanup();
    if (problems.length > 0) console.error(`gladia cleanup problems: ${problems.join('; ')}`);
    throw error;
  }
};

// Prices are list prices per audio hour, see docs/research/cloud-transcription.md.
export const CLOUD_VENDORS: CloudVendor[] = [
  { id: 'soniox', label: `Soniox ${SONIOX_MODEL}`, keyEnv: 'SONIOX_API_KEY', price: { perHour: 0.1, currency: 'USD' }, acceptsWebm: true, transcribe: soniox },
  { id: 'elevenlabs', label: `ElevenLabs ${ELEVENLABS_MODEL}`, keyEnv: 'ELEVENLABS_API_KEY', price: { perHour: 0.2, currency: 'USD' }, acceptsWebm: true, transcribe: elevenlabs },
  { id: 'gladia', label: `Gladia ${GLADIA_MODEL}`, keyEnv: 'GLADIA_API_KEY', price: { perHour: 0.27, currency: 'EUR' }, acceptsWebm: false, transcribe: gladia },
];

export const MIME: Record<string, string> = { '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' };

/** Stream copy of the opus track into an ogg container, no re-encode. */
export const remuxToOgg = (input: string): { blob: Blob; cleanup: () => void } => {
  const dir = mkdtempSync(join(os.tmpdir(), 'cloud-'));
  const output = join(dir, 'audio.ogg');
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-vn', '-c:a', 'copy', '-f', 'ogg', output], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (result.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error('ffmpeg remux to ogg failed (is the clip opus audio?)');
  }
  return { blob: new Blob([readFileSync(output)], { type: MIME['.ogg'] }), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

export const transcribeClip = async (
  vendor: CloudVendor,
  key: string,
  sourcePath: string,
  language: string,
  fetchFn: Fetch = fetch,
  poll: PollOptions = { intervalMs: 2000, timeoutMs: 10 * 60 * 1000 },
): Promise<CloudOutcome> => {
  const needsRemux = extname(sourcePath) === '.webm' && !vendor.acceptsWebm;
  const remuxed = needsRemux ? remuxToOgg(sourcePath) : undefined;
  try {
    const audio = remuxed?.blob ?? new Blob([readFileSync(sourcePath)], { type: MIME[extname(sourcePath)] ?? 'application/octet-stream' });
    const start = performance.now();
    const outcome = await vendor.transcribe(audio, language, key, fetchFn, poll);
    return { ...outcome, seconds: (performance.now() - start) / 1000 };
  } finally {
    remuxed?.cleanup();
  }
};
