import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CLOUD_VENDORS,
  elevenLabsFields,
  estimateCost,
  gladiaCreateBody,
  parseElevenLabs,
  parseGladiaResult,
  parseGladiaStatus,
  parseSonioxTranscript,
  sonioxCreateBody,
  transcribeClip,
  type Fetch,
} from './cloud.ts';

const vendor = (id: string) => CLOUD_VENDORS.find((candidate) => candidate.id === id)!;
const poll = { intervalMs: 1, timeoutMs: 1000 };

const clipPath = () => {
  const path = join(mkdtempSync(join(os.tmpdir(), 'cloud-test-')), 'clip.ogg');
  writeFileSync(path, 'not really audio');
  return path;
};

type Call = { method: string; url: string; headers: Record<string, string>; body?: unknown };

/** Answers by "METHOD path-suffix" and records every call. */
const fakeFetch = (routes: Record<string, () => Response>) => {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, headers: init.headers as Record<string, string>, body: init.body });
    const key = `${method} ${new URL(url).pathname}`;
    if (!(key in routes)) throw new Error(`unexpected ${key}`);
    return routes[key]();
  }) as unknown as Fetch;
  return { fetchFn, calls };
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const empty = (status: number) => new Response(null, { status });

test('request bodies follow the vendor docs', () => {
  assert.deepEqual(sonioxCreateBody('f1'), { model: 'stt-async-v6', file_id: 'f1', language_hints: ['hu', 'en'] });
  assert.deepEqual(gladiaCreateBody('https://api.gladia.io/file/x', 'hu'), {
    audio_url: 'https://api.gladia.io/file/x',
    model: 'solaria-1',
    language_config: { languages: ['hu'] },
  });
  assert.equal(elevenLabsFields('hu').model_id, 'scribe_v3');
  assert.equal(elevenLabsFields('hu').language_code, 'hu');
});

test('responses are parsed from the documented shapes', () => {
  assert.equal(parseSonioxTranscript({ id: 'x', text: ' Hello world ', tokens: [] }), 'Hello world');
  assert.deepEqual(parseElevenLabs({ language_code: 'en', language_probability: 0.98, text: 'Hello world!', words: [] }), { text: 'Hello world!', transcriptionId: undefined });
  assert.equal(parseElevenLabs({ text: 'a', transcription_id: 't1' }).transcriptionId, 't1');
  const done = { status: 'done', error_code: null, result: { transcription: { full_transcript: 'szia' } } };
  assert.equal(parseGladiaResult(done), 'szia');
  assert.equal(parseGladiaResult({ status: 'queued', result: null }), '');
  assert.deepEqual(parseGladiaStatus({ status: 'error', error_code: 500 }), { status: 'error', error: '500' });
});

test('cost is the audio hour price scaled to the clip length', () => {
  assert.equal(estimateCost(1800, { perHour: 0.2, currency: 'USD' }), 0.1);
});

test('soniox: uploads, polls, reads the transcript, then deletes transcription and file', async () => {
  let polls = 0;
  const { fetchFn, calls } = fakeFetch({
    'POST /v1/files': () => json({ id: 'file-1', filename: 'audio', size: 1 }, 201),
    'POST /v1/transcriptions': () => json({ id: 'tr-1', status: 'queued' }, 201),
    'GET /v1/transcriptions/tr-1': () => json({ id: 'tr-1', status: ++polls < 2 ? 'processing' : 'completed' }),
    'GET /v1/transcriptions/tr-1/transcript': () => json({ id: 'tr-1', text: 'Jó reggelt', tokens: [] }),
    'DELETE /v1/transcriptions/tr-1': () => empty(204),
    'DELETE /v1/files/file-1': () => empty(204),
  });
  const outcome = await transcribeClip(vendor('soniox'), 'secret-key', clipPath(), 'hu', fetchFn, poll);
  assert.equal(outcome.text, 'Jó reggelt');
  assert.deepEqual(outcome.deleteProblems, []);
  assert.ok(calls.every((call) => call.headers.Authorization === 'Bearer secret-key'));
  assert.equal(calls.filter((call) => call.method === 'DELETE').length, 2);
});

test('soniox: a failed job still deletes the file and transcription', async () => {
  const { fetchFn, calls } = fakeFetch({
    'POST /v1/files': () => json({ id: 'file-1' }, 201),
    'POST /v1/transcriptions': () => json({ id: 'tr-1' }, 201),
    'GET /v1/transcriptions/tr-1': () => json({ status: 'error', error_message: 'bad audio' }),
    'DELETE /v1/transcriptions/tr-1': () => empty(204),
    'DELETE /v1/files/file-1': () => empty(204),
  });
  await assert.rejects(transcribeClip(vendor('soniox'), 'k', clipPath(), 'hu', fetchFn, poll), /bad audio/);
  assert.equal(calls.filter((call) => call.method === 'DELETE').length, 2);
});

test('elevenlabs: sends the key header and multipart fields, deletes the transcript', async () => {
  const { fetchFn, calls } = fakeFetch({
    'POST /v1/speech-to-text': () => json({ language_code: 'hu', language_probability: 1, text: 'Szia', transcription_id: 't1', words: [] }),
    'DELETE /v1/speech-to-text/transcripts/t1': () => empty(200),
  });
  const outcome = await transcribeClip(vendor('elevenlabs'), 'secret-key', clipPath(), 'hu', fetchFn, poll);
  assert.equal(outcome.text, 'Szia');
  assert.deepEqual(outcome.deleteProblems, []);
  assert.equal(calls[0].headers['xi-api-key'], 'secret-key');
  const form = calls[0].body as FormData;
  assert.equal(form.get('model_id'), 'scribe_v3');
  assert.equal(form.get('language_code'), 'hu');
});

test('elevenlabs: a failed delete is reported, not hidden', async () => {
  const { fetchFn } = fakeFetch({
    'POST /v1/speech-to-text': () => json({ text: 'Szia', transcription_id: 't1' }),
    'DELETE /v1/speech-to-text/transcripts/t1': () => empty(500),
  });
  const outcome = await transcribeClip(vendor('elevenlabs'), 'k', clipPath(), 'hu', fetchFn, poll);
  assert.equal(outcome.text, 'Szia');
  assert.equal(outcome.deleteProblems.length, 1);
  assert.match(outcome.deleteProblems[0], /HTTP 500/);
});

test('elevenlabs: no transcription_id means the delete cannot happen and is reported', async () => {
  const { fetchFn } = fakeFetch({ 'POST /v1/speech-to-text': () => json({ text: 'Szia' }) });
  const outcome = await transcribeClip(vendor('elevenlabs'), 'k', clipPath(), 'hu', fetchFn, poll);
  assert.match(outcome.deleteProblems[0], /no transcription_id/);
});

test('gladia: uploads, creates a job, polls to done, deletes the job (and with it the audio)', async () => {
  let polls = 0;
  const { fetchFn, calls } = fakeFetch({
    'POST /v2/upload': () => json({ audio_url: 'https://api.gladia.io/file/abc', audio_metadata: { id: 'abc' } }, 201),
    'POST /v2/pre-recorded': () => json({ id: 'job-1', result_url: 'https://api.gladia.io/v2/pre-recorded/job-1' }, 201),
    'GET /v2/pre-recorded/job-1': () =>
      json(++polls < 2 ? { status: 'processing', result: null } : { status: 'done', result: { transcription: { full_transcript: 'Üdv' } } }),
    'DELETE /v2/pre-recorded/job-1': () => empty(202),
  });
  const outcome = await transcribeClip(vendor('gladia'), 'secret-key', clipPath(), 'hu', fetchFn, poll);
  assert.equal(outcome.text, 'Üdv');
  assert.deepEqual(outcome.deleteProblems, []);
  assert.ok(calls.every((call) => call.headers['x-gladia-key'] === 'secret-key'));
  assert.equal(JSON.parse(calls[1].body as string).audio_url, 'https://api.gladia.io/file/abc');
});

test('a job that never finishes times out and still cleans up', async () => {
  const { fetchFn, calls } = fakeFetch({
    'POST /v2/upload': () => json({ audio_url: 'u' }),
    'POST /v2/pre-recorded': () => json({ id: 'job-1' }),
    'GET /v2/pre-recorded/job-1': () => json({ status: 'processing' }),
    'DELETE /v2/pre-recorded/job-1': () => empty(202),
  });
  await assert.rejects(transcribeClip(vendor('gladia'), 'k', clipPath(), 'hu', fetchFn, { intervalMs: 1, timeoutMs: 20 }), /timed out/);
  assert.equal(calls.at(-1)!.method, 'DELETE');
});
