import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { basename, extname, join } from 'node:path';
import sherpa from 'sherpa-onnx-node';

type Language = 'hu' | 'en';
type Clip = { id: string; language: Language; wavPath: string; reference: string };
type Engine = {
  id: string;
  label: string;
  license: string;
  archiveUrl?: string;
  modelDir: string;
  config: (dir: string, language: Language) => object;
};
type ClipResult = { id: string; reference: string; hypothesis: string; seconds: number; audioSeconds: number };
type RunResult = {
  engine: string;
  language: Language;
  loadSeconds: number;
  peakRamMb: number;
  clips: ClipResult[];
  vadClips: number;
};

const CACHE = '.cache';
const THREADS = Number(process.env.THREADS ?? 4);
const CLIPS_PER_LANGUAGE = 30;
const MAX_UNSEGMENTED_SECONDS = 25;
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
    id: 'whisper-hu-turbo',
    label: 'Whisper turbo HU fine-tune int8 (sarpba)',
    license: 'MIT',
    modelDir: 'whisper-hu-turbo-ft',
    config: whisperConfig('turbo'),
  },
];

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
  const rows = readFileSync(tsv, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .map(([id, file, raw]) => ({ id, file, reference: raw }))
    .sort((a, b) => Number(a.id) - Number(b.id) || a.file.localeCompare(b.file))
    .slice(0, CLIPS_PER_LANGUAGE);

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

const loadOwnClips = (): Clip[] => {
  const dir = 'clips/own';
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => ['.wav', '.m4a', '.webm'].includes(extname(file)))
    .sort()
    .map((file) => {
      const name = basename(file, extname(file));
      const language = name.startsWith('hu-') ? 'hu' : name.startsWith('en-') ? 'en' : undefined;
      const referencePath = `${dir}/${name}.txt`;
      if (!language) throw new Error(`${file}: name must start with hu- or en-`);
      if (!existsSync(referencePath)) throw new Error(`${file}: missing ${name}.txt`);
      const wavPath = `${CACHE}/wav/own/${name}.wav`;
      convertToWav(`${dir}/${file}`, wavPath);
      return { id: name, language, wavPath, reference: readFileSync(referencePath, 'utf8') };
    });
};

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const editDistance = (reference: string[], hypothesis: string[]) => {
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, i) => i);
  for (let i = 1; i <= reference.length; i++) {
    const current = [i];
    for (let j = 1; j <= hypothesis.length; j++) {
      const substitution = previous[j - 1] + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1);
      current[j] = Math.min(substitution, previous[j] + 1, current[j - 1] + 1);
    }
    previous = current;
  }
  return previous[hypothesis.length];
};

const errorRate = (clips: ClipResult[], split: (text: string) => string[]) => {
  let errors = 0;
  let total = 0;
  for (const clip of clips) {
    const reference = split(normalize(clip.reference));
    errors += editDistance(reference, split(normalize(clip.hypothesis)));
    total += reference.length;
  }
  return errors / total;
};

const wer = (clips: ClipResult[]) => errorRate(clips, (text) => text.split(' ').filter(Boolean));
const cer = (clips: ClipResult[]) => errorRate(clips, (text) => [...text]);

const splitBySpeech = (samples: Float32Array): Float32Array[] => {
  const vad = new sherpa.Vad(
    {
      sileroVad: {
        model: VAD_MODEL,
        threshold: 0.5,
        minSpeechDuration: 0.25,
        minSilenceDuration: 0.5,
        maxSpeechDuration: 20,
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

const decode = (recognizer: any, samples: Float32Array) => {
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
  recognizer.decode(stream);
  return recognizer.getResult(stream).text.trim() as string;
};

const worker = (engineId: string, language: Language, clips: Clip[]): RunResult => {
  const engine = ENGINES.find((candidate) => candidate.id === engineId)!;
  const loadStart = performance.now();
  const recognizer = new sherpa.OfflineRecognizer(engine.config(`${CACHE}/models/${engine.modelDir}`, language));
  const loadSeconds = (performance.now() - loadStart) / 1000;

  let vadClips = 0;
  const results = clips.map((clip) => {
    const { samples } = sherpa.readWave(clip.wavPath);
    const audioSeconds = samples.length / SAMPLE_RATE;
    const start = performance.now();
    let hypothesis: string;
    if (audioSeconds > MAX_UNSEGMENTED_SECONDS) {
      vadClips++;
      hypothesis = splitBySpeech(samples)
        .map((segment) => decode(recognizer, segment))
        .join(' ');
    } else {
      hypothesis = decode(recognizer, samples);
    }
    const seconds = (performance.now() - start) / 1000;
    return { id: clip.id, reference: clip.reference, hypothesis, seconds, audioSeconds };
  });

  return {
    engine: engineId,
    language,
    loadSeconds,
    peakRamMb: process.resourceUsage().maxRSS / 1024,
    clips: results,
    vadClips,
  };
};

const runWorker = (engineId: string, language: Language, clips: Clip[], clipsFile: string): RunResult => {
  writeFileSync(clipsFile, JSON.stringify(clips));
  const result = spawnSync(process.execPath, [import.meta.filename, 'worker', engineId, language, clipsFile], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`worker ${engineId} ${language} failed`);
  return JSON.parse(result.stdout.trim().split('\n').pop()!);
};

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

const buildReport = (set: string, results: RunResult[], clipCounts: Record<Language, number>) => {
  const cpu = os.cpus();
  const rows = results.map((result) => {
    const engine = ENGINES.find((candidate) => candidate.id === result.engine)!;
    const audio = result.clips.reduce((sum, clip) => sum + clip.audioSeconds, 0);
    const decodeSeconds = result.clips.reduce((sum, clip) => sum + clip.seconds, 0);
    const size = (directorySize(`${CACHE}/models/${engine.modelDir}`) / 1e6).toFixed(0);
    return `| ${engine.label} | ${result.language} | ${pct(wer(result.clips))} | ${pct(cer(result.clips))} | ${(decodeSeconds / audio).toFixed(3)} | ${result.loadSeconds.toFixed(1)} s | ${result.peakRamMb.toFixed(0)} MB | ${size} MB | ${engine.license} | 0 |`;
  });
  return [
    `# Speech recognition eval: ${set}`,
    '',
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    `Clips: ${clipCounts.hu} Hungarian, ${clipCounts.en} English`,
    `Eval container: ${cpu[0].model}, ${cpu.length} logical cores visible, limited to ${THREADS} threads, ${(os.totalmem() / 2 ** 30).toFixed(0)} GB RAM visible`,
    `Clips longer than ${MAX_UNSEGMENTED_SECONDS} s are split with Silero VAD (sherpa-onnx): ${results.reduce((sum, result) => sum + result.vadClips, 0)} clip runs`,
    '',
    '| Engine | Lang | WER | CER | RTF | Load | Peak RAM | Model size | License | Cost |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
};

const evaluate = (set: string) => {
  const engines = ENGINES.filter((engine) => !process.env.ENGINES || process.env.ENGINES.split(',').includes(engine.id));
  download(`${RELEASES}/silero_vad.onnx`, VAD_MODEL);
  for (const engine of engines) ensureModel(engine);

  const clips = set === 'own' ? loadOwnClips() : [...loadFleursClips('hu'), ...loadFleursClips('en')];
  const resultsDir = `${CACHE}/results/${set}`;
  mkdirSync(resultsDir, { recursive: true });

  const results: RunResult[] = [];
  for (const language of ['hu', 'en'] as const) {
    const languageClips = clips.filter((clip) => clip.language === language);
    if (languageClips.length === 0) continue;
    for (const engine of engines) {
      console.error(`${engine.id} ${language}`);
      const result = runWorker(engine.id, language, languageClips, `${resultsDir}/clips-${language}.json`);
      writeFileSync(`${resultsDir}/${engine.id}-${language}.json`, JSON.stringify(result, null, 2));
      results.push(result);
    }
  }

  const clipCounts = {
    hu: clips.filter((clip) => clip.language === 'hu').length,
    en: clips.filter((clip) => clip.language === 'en').length,
  };
  mkdirSync('reports', { recursive: true });
  const reportPath = `reports/${set}-${new Date().toISOString().slice(0, 10)}.md`;
  writeFileSync(reportPath, buildReport(set, results, clipCounts));
  console.error(`wrote ${reportPath}`);
};

const [mode, ...args] = process.argv.slice(2);
if (mode === 'worker') {
  const [engineId, language, clipsFile] = args;
  console.log(JSON.stringify(worker(engineId, language as Language, JSON.parse(readFileSync(clipsFile, 'utf8')))));
} else {
  evaluate(mode ?? 'public');
}
