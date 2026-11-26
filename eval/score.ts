export type Language = 'hu' | 'en';

const EN_ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES = ['', ' thousand', ' million', ' billion'];

const englishUnder1000 = (n: number): string => {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${EN_ONES[hundreds]} hundred`);
  if (rest) parts.push(rest < 20 ? EN_ONES[rest] : EN_TENS[Math.floor(rest / 10)] + (rest % 10 ? ` ${EN_ONES[rest % 10]}` : ''));
  return parts.join(' ');
};

const englishCardinal = (n: number): string => {
  if (n === 0) return 'zero';
  const groups: string[] = [];
  for (let scale = 0; n > 0; scale++, n = Math.floor(n / 1000)) {
    if (n % 1000) groups.unshift(englishUnder1000(n % 1000) + EN_SCALES[scale]);
  }
  return groups.join(' ');
};

const englishNumber = (digits: string): string => {
  const n = Number(digits);
  if (digits.length > 12) return digits;
  const isYear = digits.length === 4 && n >= 1100 && n <= 1999 && n % 1000 !== 0;
  if (!isYear) return englishCardinal(n);
  const [high, low] = [Math.floor(n / 100), n % 100];
  if (low === 0) return `${englishCardinal(high)} hundred`;
  return `${englishCardinal(high)} ${low < 10 ? `oh ${EN_ONES[low]}` : englishCardinal(low)}`;
};

const HU_ONES = ['', 'egy', 'kettő', 'három', 'négy', 'öt', 'hat', 'hét', 'nyolc', 'kilenc'];
const HU_ONES_COMPOUND = ['', 'egy', 'két', 'három', 'négy', 'öt', 'hat', 'hét', 'nyolc', 'kilenc'];
const HU_TENS_ALONE = ['', 'tíz', 'húsz', 'harminc', 'negyven', 'ötven', 'hatvan', 'hetven', 'nyolcvan', 'kilencven'];
const HU_TENS_COMPOUND = ['', 'tizen', 'huszon', 'harminc', 'negyven', 'ötven', 'hatvan', 'hetven', 'nyolcvan', 'kilencven'];
const HU_SCALES = ['', 'ezer', 'millió', 'milliárd'];

const hungarianUnder1000 = (n: number, beforeScale: boolean): string => {
  const hundreds = Math.floor(n / 100);
  const tens = Math.floor((n % 100) / 10);
  const ones = n % 10;
  const ones_ = beforeScale ? HU_ONES_COMPOUND : HU_ONES;
  let text = '';
  if (hundreds) text += (hundreds === 1 ? '' : HU_ONES_COMPOUND[hundreds]) + 'száz';
  if (tens) text += ones ? HU_TENS_COMPOUND[tens] + ones_[ones] : HU_TENS_ALONE[tens];
  else text += ones_[ones];
  return text;
};

const hungarianCardinal = (n: number): string => {
  if (n === 0) return 'nulla';
  const total = n;
  const groups: string[] = [];
  for (let scale = 0; n > 0; scale++, n = Math.floor(n / 1000)) {
    const value = n % 1000;
    if (!value) continue;
    if (scale === 0) groups.unshift(hungarianUnder1000(value, false));
    else if (scale === 1 && value === 1) groups.unshift('ezer');
    else groups.unshift(hungarianUnder1000(value, true) + HU_SCALES[scale]);
  }
  return groups.join(total <= 2000 ? '' : ' ');
};

const hungarianNumber = (digits: string): string => (digits.length > 12 ? digits : hungarianCardinal(Number(digits)));

const numberToWords = (digits: string, language: Language) =>
  language === 'hu' ? hungarianNumber(digits) : englishNumber(digits);

const isHyphen = (char: string | undefined) => char !== undefined && /\p{Pd}/u.test(char);

const padded = (word: string, offset: number, length: number, text: string) =>
  `${isHyphen(text[offset - 1]) ? '' : ' '}${word}${isHyphen(text[offset + length]) ? '' : ' '}`;

const spellNumbers = (text: string, language: Language): string => {
  const decimal = language === 'hu' ? /(\d+),(\d+)/g : /(\d+)\.(\d+)/g;
  const point = language === 'hu' ? 'egész' : 'point';
  return text
    .replace(/%/g, (_match, offset, all) => padded(language === 'hu' ? 'százalék' : 'percent', offset, 1, all))
    .replace(decimal, (match, whole, fraction, offset, all) =>
      padded(`${numberToWords(whole, language)} ${point} ${numberToWords(fraction, language)}`, offset, match.length, all))
    .replace(/\d+/g, (digits, offset, all) => padded(numberToWords(digits, language), offset, digits.length, all));
};

/** The scoring used in round 1: lowercase, apostrophes dropped, punctuation and symbols become spaces. */
export const normalizeOld = (text: string) =>
  text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

type Variant = { spellOutNumbers: boolean; joinHyphens: boolean };

const VARIANTS: Variant[] = [
  { spellOutNumbers: false, joinHyphens: false },
  { spellOutNumbers: false, joinHyphens: true },
  { spellOutNumbers: true, joinHyphens: false },
  { spellOutNumbers: true, joinHyphens: true },
];

const normalizeNew = (text: string, language: Language, variant: Variant) => {
  let result = text
    .normalize('NFC')
    .replace(/[õÕ]/g, 'ő')
    .replace(/[ûÛ]/g, 'ű')
    .toLowerCase()
    .replace(/[­​-‍﻿]/g, '')
    .replace(/[  ]/g, ' ')
    .replace(/(\d) (?=\d{3}(?!\d))/g, '$1')
    .replace(/(\d),(?=\d{3}(?!\d))/g, language === 'en' ? '$1' : '$1,');
  if (variant.spellOutNumbers) result = spellNumbers(result, language);
  result = result.replace(/['’ʼ`´]/g, '');
  const hyphen = /(?<=[\p{L}\p{N}])\p{Pd}(?=[\p{L}\p{N}])/gu;
  result = result.replace(hyphen, variant.joinHyphens ? '' : ' ');
  return result
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export type Op = { kind: 'same' | 'sub' | 'del' | 'ins'; reference?: string; hypothesis?: string };

const align = (reference: string[], hypothesis: string[]): Op[] => {
  const rows = reference.length + 1;
  const columns = hypothesis.length + 1;
  const cost = Array.from({ length: rows }, () => new Uint32Array(columns));
  for (let i = 0; i < rows; i++) cost[i][0] = i;
  for (let j = 0; j < columns; j++) cost[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < columns; j++) {
      const diagonal = cost[i - 1][j - 1] + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1);
      cost[i][j] = Math.min(diagonal, cost[i - 1][j] + 1, cost[i][j - 1] + 1);
    }
  }
  const ops: Op[] = [];
  let i = reference.length;
  let j = hypothesis.length;
  while (i > 0 || j > 0) {
    const same = i > 0 && j > 0 && reference[i - 1] === hypothesis[j - 1];
    if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + (same ? 0 : 1)) {
      ops.push(same ? { kind: 'same', reference: reference[i - 1] } : { kind: 'sub', reference: reference[i - 1], hypothesis: hypothesis[j - 1] });
      i--;
      j--;
    } else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      ops.push({ kind: 'del', reference: reference[i - 1] });
      i--;
    } else {
      ops.push({ kind: 'ins', hypothesis: hypothesis[j - 1] });
      j--;
    }
  }
  return ops.reverse();
};

const distance = (reference: string[], hypothesis: string[]) =>
  align(reference, hypothesis).filter((op) => op.kind !== 'same').length;

const words = (text: string) => text.split(' ').filter(Boolean);

export type ClipScore = {
  wordErrors: number;
  referenceWords: number;
  charErrors: number;
  referenceChars: number;
  oldWordErrors: number;
  oldReferenceWords: number;
  oldCharErrors: number;
  oldReferenceChars: number;
  diff: string;
  referenceText: string;
  hypothesisText: string;
};

/** Marks differences as [-reference-] {+hypothesis+}. */
export const renderDiff = (ops: Op[]) =>
  ops
    .map((op) => {
      if (op.kind === 'same') return op.reference;
      if (op.kind === 'sub') return `[-${op.reference}-]{+${op.hypothesis}+}`;
      if (op.kind === 'del') return `[-${op.reference}-]`;
      return `{+${op.hypothesis}+}`;
    })
    .join(' ');

/**
 * New scoring: Unicode cleanup, casing, punctuation, hyphens, and numbers. Hyphen handling (split or join)
 * and number form (digits or spelled out) are applied to both sides alike, and the clip gets the variant
 * with the fewest errors, so a model is not punished for a spelling choice the reference does not share.
 */
export const scoreClip = (reference: string, hypothesis: string, language: Language): ClipScore => {
  const oldReference = normalizeOld(reference);
  const oldHypothesis = normalizeOld(hypothesis);

  let bestWords: { errors: number; reference: string[]; hypothesis: string[] } | undefined;
  let bestChars: { errors: number; length: number } | undefined;
  for (const variant of VARIANTS) {
    const normalizedReference = normalizeNew(reference, language, variant);
    const normalizedHypothesis = normalizeNew(hypothesis, language, variant);
    const referenceWords = words(normalizedReference);
    const hypothesisWords = words(normalizedHypothesis);
    const wordErrors = distance(referenceWords, hypothesisWords);
    if (!bestWords || wordErrors < bestWords.errors) {
      bestWords = { errors: wordErrors, reference: referenceWords, hypothesis: hypothesisWords };
    }
    const referenceChars = [...normalizedReference];
    const charErrors = distance(referenceChars, [...normalizedHypothesis]);
    if (!bestChars || charErrors < bestChars.errors) bestChars = { errors: charErrors, length: referenceChars.length };
  }

  return {
    wordErrors: bestWords!.errors,
    referenceWords: bestWords!.reference.length,
    charErrors: bestChars!.errors,
    referenceChars: bestChars!.length,
    oldWordErrors: distance(words(oldReference), words(oldHypothesis)),
    oldReferenceWords: words(oldReference).length,
    oldCharErrors: distance([...oldReference], [...oldHypothesis]),
    oldReferenceChars: [...oldReference].length,
    diff: renderDiff(align(bestWords!.reference, bestWords!.hypothesis)),
    referenceText: reference,
    hypothesisText: hypothesis,
  };
};

export type Totals = { wer: number; cer: number; oldWer: number; oldCer: number };

export const totals = (scores: ClipScore[]): Totals => {
  const sum = (pick: (score: ClipScore) => number) => scores.reduce((total, score) => total + pick(score), 0);
  return {
    wer: sum((s) => s.wordErrors) / sum((s) => s.referenceWords),
    cer: sum((s) => s.charErrors) / sum((s) => s.referenceChars),
    oldWer: sum((s) => s.oldWordErrors) / sum((s) => s.oldReferenceWords),
    oldCer: sum((s) => s.oldCharErrors) / sum((s) => s.oldReferenceChars),
  };
};
