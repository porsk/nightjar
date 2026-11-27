import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { basename, extname, join } from 'node:path';
import sherpa from 'sherpa-onnx-node';
import { CLOUD_VENDORS, estimateCost, transcribeClip, type CloudVendor } from './cloud.ts';
import { scoreClip, totals, type ClipScore, type Language } from './score.ts';

type Clip = { id: string; language: Language; wavPath: string; sourcePath?: string; reference: string };
type Engine = {
  id: string;
  label: string;
  license: string;
  languages?: Language[];
  downloadNote?: string;
  archiveUrl?: string;
  modelDir?: string;
  config?: (dir: string, language: Language) => object;
  cloud?: CloudVendor;
};
type ClipResult = {
  id: string;
  reference: string;
  hypothesis: string;
  seconds: number;
  audioSeconds: number;
  loopPieces: number;
  loopLeft: boolean;
  cost?: number;
  deleteProblems?: string[];
};
type RunResult = {
  engine: string;
  variant: string;
  language: Language;
  loadSeconds: number;
  peakRamMb: number;
  clips: ClipResult[];
  vadClips: number;
  currency?: string;
};

const CACHE = '.cache';
const THREADS = Number(process.env.THREADS ?? 4);
const CLIPS_PER_LANGUAGE = Number(process.env.CLIPS ?? 150);
const MAX_UNSEGMENTED_SECONDS = 25;
const MAX_TOKENS_PER_SECOND = '25';
const LOOP_COMPRESSION_RATIO = 2.4;
const SAMPLE_RATE = 16000;
const RELEASES = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';
const VAD_MODEL = `${CACHE}/models/silero_vad.onnx`;
const FLEURS_URL = 'https://huggingface.co/datasets/google/fleurs/resolve/main/data';
const FLEURS_LOCALE = { hu: 'hu_hu', en: 'en_us' } as const;

const whisperConfig = (prefix: string) => (dir: string, language: Language) => ({
  featConfig: { sampleRate: SAMPLE_RATE, featureDim: 128 },
  modelConfig: {
    whisper: {
      encoder: `${dir}/${prefix}-encoder.int8.onnx`,
      decoder: `${dir}/${prefix}-decoder.int8.onnx`,
      language,
      task: 'transcribe',
    },
    tokens: `${dir}/${prefix}-tokens.txt`,
    numThreads: THREADS,
    provider: 'cpu',
  },
});

const ENGINES: Engine[] = [
  {
    id: 'parakeet-v3',
    label: 'Parakeet TDT 0.6B v3 int8',
    license: 'CC-BY-4.0',
    archiveUrl: `${RELEASES}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`,
    modelDir: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
    config: (dir) => ({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: `${dir}/encoder.int8.onnx`,
          decoder: `${dir}/decoder.int8.onnx`,
          joiner: `${dir}/joiner.int8.onnx`,
        },
        tokens: `${dir}/tokens.txt`,
        modelType: 'nemo_transducer',
        numThreads: THREADS,
        provider: 'cpu',
      },
    }),
  },
  {
    id: 'whisper-turbo',
    label: 'Whisper large-v3-turbo int8',
    license: 'MIT',
    archiveUrl: `${RELEASES}/sherpa-onnx-whisper-turbo.tar.bz2`,
    modelDir: 'sherpa-onnx-whisper-turbo',
    config: whisperConfig('turbo'),
  },
  {
    id: 'whisper-large-v3',
    label: 'Whisper large-v3 int8',
    license: 'MIT',
    archiveUrl: `${RELEASES}/sherpa-onnx-whisper-large-v3.tar.bz2`,
    modelDir: 'sherpa-onnx-whisper-large-v3',
    config: whisperConfig('large-v3'),
  },
  {
    id: 'whisper-buzz-hu',
    label: 'BuzzASR Hungarian (large-v3 fine-tune) int8',
    license: 'MIT',
    languages: ['hu'],
    downloadNote: '3.1 GB fp16 safetensors (HF), we export to int8 ourselves',
    modelDir: 'whisper-buzz-hu-large-v3',
    config: whisperConfig('large-v3'),
  },
  {
    id: 'canary-1b-v2',
    label: 'Canary-1B-v2 int8 (community export)',
    license: 'CC-BY-4.0 (NVIDIA; the export repo says apache-2.0)',
    downloadNote: '1.9 GB (HF YaroslavGor/sherpa-onnx-nemo-canary-1b-v2-int)',
    modelDir: 'canary-1b-v2',
    config: (dir, language) => ({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 128 },
      modelConfig: {
        canary: { encoder: `${dir}/encoder.int8.onnx`, decoder: `${dir}/decoder.int8.onnx`, srcLang: language, tgtLang: language, usePnc: true },
        tokens: `${dir}/tokens.txt`,
        numThreads: THREADS,
        provider: 'cpu',
      },
    }),
  },
];

const CLOUD_ENGINES: Engine[] = CLOUD_VENDORS.map((vendor) => ({ id: vendor.id, label: vendor.label, license: 'cloud', languages: ['hu', 'en'], cloud: vendor }));
ENGINES.push(...CLOUD_ENGINES);

const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
};

const download = (url: string, path: string) => {
  if (existsSync(path)) return;
  mkdirSync(join(path, '..'), { recursive: true });
  run('curl', ['-fL', '--retry', '3', '-o', `${path}.part`, url]);
  run('mv', [`${path}.part`, path]);
};

const directorySize = (dir: string): number =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (sum, entry) =>
      sum + (entry.isDirectory() ? directorySize(join(dir, entry.name)) : statSync(join(dir, entry.name)).size),
    0,
  );

const ensureModel = (engine: Engine) => {
  const dir = `${CACHE}/models/${engine.modelDir}`;
  if (existsSync(dir)) return dir;
  if (!engine.archiveUrl) {
    throw new Error(`${dir} is missing. Run: docker compose --profile export run --rm export`);
  }
  const archive = `${CACHE}/models/${basename(engine.archiveUrl)}`;
  download(engine.archiveUrl, archive);
  run('tar', ['-xjf', archive, '-C', `${CACHE}/models`]);
  return dir;
};

const convertToWav = (input: string, output: string) => {
  if (existsSync(output)) return;
  mkdirSync(join(output, '..'), { recursive: true });
  run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-ac', '1', '-ar', String(SAMPLE_RATE), output]);
};

const loadFleursClips = (language: Language): Clip[] => {
  const locale = FLEURS_LOCALE[language];
  const tsv = `${CACHE}/fleurs/${locale}/test.tsv`;
  download(`${FLEURS_URL}/${locale}/test.tsv`, tsv);
  const rows: { id: string; file: string; reference: string }[] = readFileSync(tsv, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .map(([id, file, raw]) => ({ id, file, reference: raw }))
    .sort((a, b) => Number(a.id) - Number(b.id) || a.file.localeCompare(b.file));
  const seen = new Set<string>();
  const distinct = rows.filter((row) => !seen.has(row.reference) && seen.add(row.reference));
  const step = distinct.length / CLIPS_PER_LANGUAGE;
  const picked = Array.from({ length: Math.min(CLIPS_PER_LANGUAGE, distinct.length) }, (_, i) => distinct[Math.floor(i * step)]);
  return loadFleursAudio(language, locale, picked);
};

const loadFleursAudio = (language: Language, locale: string, rows: { id: string; file: string; reference: string }[]): Clip[] => {

  const rawDir = `${CACHE}/fleurs/${locale}/raw`;
  if (!rows.every((row) => existsSync(`${rawDir}/${row.file}`))) {
    mkdirSync(rawDir, { recursive: true });
    const members = rows.map((row) => `test/${row.file}`).join(' ');
    run('sh', [
      '-c',
      `curl -fL --retry 3 ${FLEURS_URL}/${locale}/audio/test.tar.gz | tar -xz -C ${rawDir} --strip-components=1 ${members}`,
    ]);
  }
  return rows.map((row) => {
    const wavPath = `${CACHE}/wav/fleurs-${locale}/${row.file}`;
    convertToWav(`${rawDir}/${row.file}`, wavPath);
    return { id: `${locale}-${row.id}-${row.file.slice(0, 6)}`, language, wavPath, reference: row.reference };
  });
};

const loadOwnClips = (): Clip[] =>
  (['hu', 'en'] as const).flatMap((language) => {
    const dir = `clips/own/${language}`;
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((file) => ['.wav', '.m4a', '.webm'].includes(extname(file)))
      .sort()
      .map((file) => {
        const name = basename(file, extname(file));
        const referencePath = `${dir}/${name}.txt`;
        if (!existsSync(referencePath)) throw new Error(`${dir}/${file}: missing ${name}.txt`);
        const wavPath = `${CACHE}/wav/own/${language}/${name}.wav`;
        convertToWav(`${dir}/${file}`, wavPath);
        return { id: name, language, wavPath, sourcePath: `${dir}/${file}`, reference: readFileSync(referencePath, 'utf8') };
      });
  });

/** P0 is production. The others change one thing each, to see what helps. */
type Variant = { id: string; label: string; vadAll: boolean; threshold: number; maxSpeech: number; loopGuard: boolean };
const VARIANTS: Variant[] = [
  { id: 'P0', label: 'production', vadAll: false, threshold: 0.5, maxSpeech: 20, loopGuard: false },
  { id: 'P1a', label: 'VAD always, max 10 s', vadAll: true, threshold: 0.5, maxSpeech: 10, loopGuard: false },
  { id: 'P1b', label: 'VAD always, max 15 s', vadAll: true, threshold: 0.5, maxSpeech: 15, loopGuard: false },
  { id: 'P2', label: 'production + loop guard', vadAll: false, threshold: 0.5, maxSpeech: 20, loopGuard: true },
  { id: 'P3', label: 'VAD always, threshold 0.35', vadAll: true, threshold: 0.35, maxSpeech: 20, loopGuard: false },
  { id: 'P4', label: 'VAD always, max 15 s + loop guard', vadAll: true, threshold: 0.5, maxSpeech: 15, loopGuard: true },
  { id: 'P5', label: 'VAD always, threshold 0.35 + loop guard', vadAll: true, threshold: 0.35, maxSpeech: 20, loopGuard: true },
];

const repeatedWordRun = (words: string[]) => {
  for (let n = 1; n <= 8; n++) {
    for (let i = 0; i + 3 * n <= words.length; i++) {
      const unit = words.slice(i, i + n).join(' ');
      let count = 1;
      while (i + (count + 1) * n <= words.length && words.slice(i + count * n, i + (count + 1) * n).join(' ') === unit) count++;
      if (count >= 3) return { start: i, length: n };
    }
  }
  return undefined;
};

const CHARACTER_LOOP = /(.{3,12}?)\1{2,}/u;

/** A loop is the same word group or the same 3+ characters three times in a row, or text that gzips too well. */
const isLoop = (text: string) => {
  const lower = text.toLowerCase();
  if (CHARACTER_LOOP.test(lower) || repeatedWordRun(lower.split(/\s+/).filter(Boolean))) return true;
  const bytes = Buffer.from(text);
  return bytes.length > 0 && bytes.length / gzipSync(bytes).length > LOOP_COMPRESSION_RATIO;
};

/** Keeps one copy of a repeated character group and drops a repeated word group together with everything after it. */
const cutLoop = (text: string) => {
  const collapsed = text.replace(new RegExp(CHARACTER_LOOP, 'giu'), '$1');
  const words = collapsed.split(/\s+/).filter(Boolean);
  const run = repeatedWordRun(words.map((word) => word.toLowerCase()));
  return (run ? words.slice(0, run.start + run.length) : words).join(' ');
};

const quietestSplit = (samples: Float32Array) => {
  const frame = SAMPLE_RATE / 50;
  const from = Math.floor((samples.length * 0.3) / frame);
  const to = Math.floor((samples.length * 0.7) / frame);
  let best = Math.floor((from + to) / 2);
  let bestEnergy = Infinity;
  for (let f = from; f < to; f++) {
    let energy = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) energy += samples[i] * samples[i];
    if (energy < bestEnergy) {
      bestEnergy = energy;
      best = f;
    }
  }
  return best * frame + frame / 2;
};

const splitBySpeech = (samples: Float32Array, variant: Variant): Float32Array[] => {
  const vad = new sherpa.Vad(
    {
      sileroVad: {
        model: VAD_MODEL,
        threshold: variant.threshold,
        minSpeechDuration: 0.25,
        minSilenceDuration: 0.5,
        maxSpeechDuration: variant.maxSpeech,
        windowSize: 512,
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
    },
    60,
  );
  const segments: Float32Array[] = [];
  const drain = () => {
    while (!vad.isEmpty()) {
      segments.push(vad.front().samples);
      vad.pop();
    }
  };
  for (let i = 0; i < samples.length; i += 512) {
    vad.acceptWaveform(samples.subarray(i, i + 512));
    drain();
  }
  vad.flush();
  drain();
  return segments;
};

const decode = (recognizer: any, samples: Float32Array, whisper: boolean) => {
  const stream = recognizer.createStream();
  if (whisper) stream.setOption('max_tokens_per_second', MAX_TOKENS_PER_SECOND);
  stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
  recognizer.decode(stream);
  return recognizer.getResult(stream).text.trim() as string;
};

const worker = (engineId: string, language: Language, clips: Clip[], variantId: string): RunResult => {
  const engine = ENGINES.find((candidate) => candidate.id === engineId)!;
  const variant = VARIANTS.find((candidate) => candidate.id === variantId)!;
  const whisper = engineId.startsWith('whisper');
  const loadStart = performance.now();
  const recognizer = new sherpa.OfflineRecognizer(engine.config!(`${CACHE}/models/${engine.modelDir}`, language));
  const loadSeconds = (performance.now() - loadStart) / 1000;

  let loopPieces = 0;
  const decodePiece = (samples: Float32Array): string => {
    const text = decode(recognizer, samples, whisper);
    if (!isLoop(text)) return text;
    loopPieces++;
    if (!variant.loopGuard) return text;
    const split = quietestSplit(samples);
    const halves = [samples.subarray(0, split), samples.subarray(split)].map((half) => decode(recognizer, half, whisper));
    return halves.map((half) => (isLoop(half) ? cutLoop(half) : half)).join(' ');
  };

  let vadClips = 0;
  const results = clips.map((clip) => {
    const { samples } = sherpa.readWave(clip.wavPath);
    const audioSeconds = samples.length / SAMPLE_RATE;
    loopPieces = 0;
    const start = performance.now();
    let hypothesis: string;
    if (variant.vadAll || audioSeconds > MAX_UNSEGMENTED_SECONDS) {
      vadClips++;
      hypothesis = splitBySpeech(samples, variant)
        .map((segment) => decodePiece(segment))
        .join(' ');
    } else {
      hypothesis = decodePiece(samples);
    }
    const seconds = (performance.now() - start) / 1000;
    return { id: clip.id, reference: clip.reference, hypothesis, seconds, audioSeconds, loopPieces, loopLeft: isLoop(hypothesis) };
  });

  return {
    engine: engineId,
    variant: variantId,
    language,
    loadSeconds,
    peakRamMb: process.resourceUsage().maxRSS / 1024,
    clips: results,
    vadClips,
  };
};

/** Returns undefined when the vendor's key is missing, so the engine is skipped. */
const runCloud = async (engine: Engine, language: Language, clips: Clip[]): Promise<RunResult | undefined> => {
  const vendor = engine.cloud!;
  const key = process.env[vendor.keyEnv];
  if (!key) {
    console.error(`skipping ${engine.id}: ${vendor.keyEnv} is not set (see README, "Cloud engines")`);
    return undefined;
  }
  const results: ClipResult[] = [];
  for (const [index, clip] of clips.entries()) {
    console.error(`${engine.id} ${language} clip ${index + 1}/${clips.length}`);
    const audioSeconds = sherpa.readWave(clip.wavPath).samples.length / SAMPLE_RATE;
    const outcome = await transcribeClip(vendor, key, clip.sourcePath!, language);
    if (outcome.deleteProblems.length > 0) console.error(`WARNING ${engine.id} clip ${index + 1}: data may still be at the vendor: ${outcome.deleteProblems.join('; ')}`);
    const loop = isLoop(outcome.text);
    results.push({
      id: clip.id,
      reference: clip.reference,
      hypothesis: outcome.text,
      seconds: outcome.seconds,
      audioSeconds,
      loopPieces: loop ? 1 : 0,
      loopLeft: loop,
      cost: estimateCost(audioSeconds, vendor.price),
      deleteProblems: outcome.deleteProblems,
    });
  }
  return { engine: engine.id, variant: 'P0', language, loadSeconds: 0, peakRamMb: 0, clips: results, vadClips: 0, currency: vendor.price.currency };
};

const runWorker = (engineId: string, language: Language, clips: Clip[], clipsFile: string, variantId: string): RunResult => {
  writeFileSync(clipsFile, JSON.stringify(clips));
  const result = spawnSync(process.execPath, [import.meta.filename, 'worker', engineId, language, clipsFile, variantId], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`worker ${engineId} ${language} ${variantId} failed`);
  return JSON.parse(result.stdout.trim().split('\n').pop()!);
};

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

const NOTES_FILE = 'reports/public-round2-notes.md';
const EXAMPLES_PER_RUN = 3;

const scoreRun = (result: RunResult) => result.clips.map((clip) => scoreClip(clip.reference, clip.hypothesis, result.language));

const downloadSize = (engine: Engine) => {
  if (!engine.archiveUrl) return engine.downloadNote ?? '-';
  const archive = `${CACHE}/models/${basename(engine.archiveUrl)}`;
  return existsSync(archive) ? `${(statSync(archive).size / 1e6).toFixed(0)} MB` : '-';
};

/** Picks clips at the 50th, 75th and 95th percentile of per-clip errors, among clips that have errors. */
const exampleClips = (scores: ClipScore[]) => {
  const withErrors = scores.filter((score) => score.wordErrors > 0).sort((a, b) => a.wordErrors / a.referenceWords - b.wordErrors / b.referenceWords);
  const picks = [0.5, 0.75, 0.95].slice(0, EXAMPLES_PER_RUN).map((q) => withErrors[Math.min(withErrors.length - 1, Math.floor(q * withErrors.length))]);
  return picks.filter((score, index) => score && picks.indexOf(score) === index);
};

const buildReport = (results: RunResult[], clipCounts: Record<Language, number>, audioSeconds: Record<Language, number>) => {
  const cpu = os.cpus();
  const label = (id: string) => ENGINES.find((engine) => engine.id === id)!;
  const rows = results.map((result) => {
    const engine = label(result.engine);
    const t = totals(scoreRun(result));
    const audio = result.clips.reduce((sum, clip) => sum + clip.audioSeconds, 0);
    const decodeSeconds = result.clips.reduce((sum, clip) => sum + clip.seconds, 0);
    const size = (directorySize(`${CACHE}/models/${engine.modelDir}`) / 1e6).toFixed(0);
    return `| ${engine.label} | ${result.language} | ${pct(t.wer)} | ${pct(t.cer)} | ${pct(t.oldWer)} | ${pct(t.oldCer)} | ${(decodeSeconds / audio).toFixed(3)} | ${result.loadSeconds.toFixed(1)} s | ${result.peakRamMb.toFixed(0)} MB | ${downloadSize(engine)} | ${size} MB | ${engine.license} |`;
  });

  const examples = results.flatMap((result) => {
    const engine = label(result.engine);
    return [
      `### ${engine.label}, ${result.language}`,
      '',
      ...exampleClips(scoreRun(result)).flatMap((score) => [
        `- Reference: ${score.referenceText}`,
        `- Heard: ${score.hypothesisText}`,
        `- Diff (new scoring): ${score.diff}`,
        '',
      ]),
    ];
  });

  const notes = existsSync(NOTES_FILE) ? readFileSync(NOTES_FILE, 'utf8').trim() : '_No hand-written notes yet. Add them to reports/public-round2-notes.md._';

  return [
    '# Speech recognition eval, round 2: public',
    '',
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    `Clips: ${clipCounts.hu} Hungarian (${(audioSeconds.hu / 60).toFixed(0)} min), ${clipCounts.en} English (${(audioSeconds.en / 60).toFixed(0)} min), FLEURS test split, distinct sentences, evenly spread over the split, one speaker each`,
    `Eval container: ${cpu[0].model}, ${cpu.length} logical cores visible, limited to ${THREADS} threads and 4 CPUs, ${(os.totalmem() / 2 ** 30).toFixed(0)} GB RAM visible`,
    `Clips longer than ${MAX_UNSEGMENTED_SECONDS} s are split with Silero VAD: ${results.reduce((sum, result) => sum + result.vadClips, 0)} clip runs in total`,
    '',
    '"New" is the fairer scoring (casing, Unicode, punctuation, hyphen choice, digits vs spelled-out numbers, see README). "Old" is the round 1 scoring. WER and CER are over all clips of the language (errors summed, divided by reference length).',
    '',
    '| Engine | Lang | WER new | CER new | WER old | CER old | RTF | Load | Peak RAM | Download | On disk | License |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    notes,
    '',
    '## Example errors',
    '',
    'Clips at the 50th, 75th and 95th percentile of per-clip word error rate (only clips with errors). `[-reference-]{+heard+}`, words after new normalization.',
    '',
    ...examples,
  ].join('\n');
};

/** Numbers only, no transcripts. Own clips are private. */
const buildOwnReport = (results: RunResult[]) => {
  const clipLabels = results[0]?.clips.map((clip, index) => `c${index + 1}`) ?? [];
  const rows = results.map((result) => {
    const scores = scoreRun(result);
    const t = totals(scores);
    const audio = result.clips.reduce((sum, clip) => sum + clip.audioSeconds, 0);
    const decodeSeconds = result.clips.reduce((sum, clip) => sum + clip.seconds, 0);
    const loopPieces = result.clips.reduce((sum, clip) => sum + clip.loopPieces, 0);
    const loopLeft = result.clips.filter((clip) => clip.loopLeft).length;
    const cost = result.clips.some((clip) => clip.cost !== undefined) ? `${result.clips.reduce((sum, clip) => sum + (clip.cost ?? 0), 0).toFixed(4)} ${result.currency}` : '-';
    const deleteFailures = result.clips.filter((clip) => clip.deleteProblems?.length).length;
    const cloud = result.currency !== undefined;
    const perClip = scores.map((score) => pct(score.wordErrors / score.referenceWords)).join(' | ');
    const label = VARIANTS.find((variant) => variant.id === result.variant)?.label ?? result.variant;
    return `| ${result.engine} | ${result.variant} ${label} | ${pct(t.wer)} | ${pct(t.cer)} | ${loopPieces} / ${loopLeft} | ${(decodeSeconds / audio).toFixed(2)} | ${decodeSeconds.toFixed(0)} s | ${cloud ? '-' : `${result.peakRamMb.toFixed(0)} MB`} | ${cost} | ${cloud ? deleteFailures : '-'} | ${perClip} |`;
  });
  return [
    '# Own clips',
    '',
    `Date: ${new Date().toISOString().slice(0, 10)}. Loops: pieces flagged on first decode / clips still flagged in the final text. For cloud engines Wall is upload to transcript (RTF uses it), Cost is the list price estimate, Delete fails counts clips where a vendor delete call failed.`,
    '',
    `| Engine | Variant | WER | CER | Loops | RTF | Wall | Peak RAM | Cost | Delete fails | ${clipLabels.join(' | ')} |`,
    `|---|---|---|---|---|---|---|---|---|---|${clipLabels.map(() => '---').join('|')}|`,
    ...rows,
  ].join('\n');
};

const evaluate = async (set: string) => {
  const reportOnly = set === 'report';
  const resultsSet = set === 'own' ? 'own' : 'public-round2';
  const requested = process.env.ENGINES?.split(',');
  const engines = ENGINES.filter((engine) => (!requested || requested.includes(engine.id)) && (set === 'own' || !engine.cloud));
  if (!reportOnly) {
    download(`${RELEASES}/silero_vad.onnx`, VAD_MODEL);
    for (const engine of engines) if (!engine.cloud) ensureModel(engine);
  }

  const clips = set === 'own' ? loadOwnClips() : [...loadFleursClips('hu'), ...loadFleursClips('en')];
  const resultsDir = `${CACHE}/results/${resultsSet}`;
  mkdirSync(resultsDir, { recursive: true });

  const results: RunResult[] = [];
  for (const language of ['hu', 'en'] as const) {
    const languageClips = clips.filter((clip) => clip.language === language);
    if (languageClips.length === 0) continue;
    for (const engine of engines) {
      if (engine.languages && !engine.languages.includes(language)) continue;
      const own = set === 'own';
      const wanted = process.env.VARIANTS?.split(',');
      const variants = (own && engine.id.startsWith('whisper') ? VARIANTS : [VARIANTS[0]]).filter((variant) => !wanted || wanted.includes(variant.id));
      for (const variant of variants) {
      const resultFile = `${resultsDir}/${engine.id}-${language}${own ? `-${variant.id}` : ''}.json`;
      const cached = existsSync(resultFile) ? (JSON.parse(readFileSync(resultFile, 'utf8')) as RunResult) : undefined;
      if (cached && cached.clips.length === languageClips.length && !process.env.FORCE) {
        results.push(cached);
        continue;
      }
      if (reportOnly) continue;
      console.error(`${engine.id} ${language} ${variant.id}`);
      try {
        const result = engine.cloud
          ? await runCloud(engine, language, languageClips)
          : runWorker(engine.id, language, languageClips, `${resultsDir}/clips-${language}.json`, variant.id);
        if (!result) continue;
        writeFileSync(resultFile, JSON.stringify(result, null, 2));
        results.push(result);
      } catch (error) {
        console.error(`FAILED ${engine.id} ${language} ${variant.id}: ${(error as Error).message}`);
      }
      }
    }
  }

  const clipCounts = {
    hu: clips.filter((clip) => clip.language === 'hu').length,
    en: clips.filter((clip) => clip.language === 'en').length,
  };
  const audioSeconds = { hu: 0, en: 0 };
  for (const clip of clips) audioSeconds[clip.language] += sherpa.readWave(clip.wavPath).samples.length / SAMPLE_RATE;
  mkdirSync('reports', { recursive: true });
  const prefix = set === 'own' ? 'own' : 'public-round2';
  const reportPath = `reports/${prefix}-${new Date().toISOString().slice(0, 10)}.md`;
  writeFileSync(reportPath, set === 'own' ? buildOwnReport(results) : buildReport(results, clipCounts, audioSeconds));
  console.error(`wrote ${reportPath}`);
};

const [mode, ...args] = process.argv.slice(2);
if (mode === 'worker') {
  const [engineId, language, clipsFile, variantId] = args;
  console.log(JSON.stringify(worker(engineId, language as Language, JSON.parse(readFileSync(clipsFile, 'utf8')), variantId)));
} else {
  await evaluate(mode ?? 'public');
}
