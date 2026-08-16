/**
 * セッションの組み立てと SCORE。
 *
 * ★コードのどこにも数字の 10 を直接書かない。
 *   level配分も比率として保持し、問題数から枠数を算出する（20問なら自動で 2:8:10）。
 *   満点も QUESTIONS_PER_SESSION から算出する（配点10/5/0点自体は固定値）。
 */
import { buildChoices } from "./distractors";
import { idKey } from "./ids";
import { shuffle } from "./shuffle";
import type {
  AnsweredQuestion,
  CardMap,
  Cause,
  Level,
  Question,
  Rng,
  SessionSummary,
  WordEntry,
  WordStatMap,
} from "./types";
import type { Wordlist } from "./wordlist";

export const QUESTIONS_PER_SESSION = 10;

/** L1:L2:L3。比率として持ち、問題数から枠数を算出する */
export const LEVEL_RATIO: Readonly<Record<Level, number>> = { 1: 1, 2: 4, 3: 5 };

/** 配点そのものは固定値。満点だけ問題数から算出する */
export const POINTS = { instantCorrect: 10, slowCorrect: 5, wrong: 0 } as const;

const LEVELS: Level[] = [1, 2, 3];

/**
 * 最大剰余法（ハミルトン方式）。
 * 小数部の降順に1枠ずつ配り、同値のタイブレークは level 降順（L3優先）。
 * L3を優先する理由：TOEIC700突破が目的でL3はプール最大かつ伸びしろが大きい。
 */
export function allocateLevelSlots(total: number): Record<Level, number> {
  const sum = LEVELS.reduce((acc, l) => acc + LEVEL_RATIO[l], 0);
  const raw = {} as Record<Level, number>;
  const slots = {} as Record<Level, number>;

  for (const l of LEVELS) {
    raw[l] = (total * LEVEL_RATIO[l]) / sum;
    slots[l] = Math.floor(raw[l]);
  }

  let remainder = total - LEVELS.reduce((acc, l) => acc + slots[l], 0);
  const order = [...LEVELS].sort((a, b) => {
    const fracDiff = raw[b] - slots[b] - (raw[a] - slots[a]);
    if (fracDiff !== 0) return fracDiff;
    return b - a; // 同値は level 降順（L3優先）
  });

  for (const l of order) {
    if (remainder <= 0) break;
    slots[l] += 1;
    remainder -= 1;
  }

  return slots;
}

type Tier = 0 | 1 | 2;

const tierOf = (e: WordEntry, cards: CardMap, wordStats: WordStatMap): Tier => {
  if (cards[idKey(e.id)] !== undefined) return 0;
  if (wordStats[idKey(e.id)] === undefined) return 1;
  return 2;
};

/**
 * ★同値（tie）の中だけをシャッフルする（docs/spec.md §5-3）。
 *
 * ソート済み配列全体に shuffle() を掛けてはいけない。
 * それをすると「missCount 降順」「lastSeenAt 昇順」というソートキーの
 * 指定が無意味になり、tier分けそのものが機能しなくなる。
 * シャッフルの役目は同着の解消のみ。
 */
function shuffleWithinTies<T>(
  sorted: readonly T[],
  keyOf: (item: T) => string,
  rng: Rng,
): T[] {
  const out: T[] = [];
  let group: T[] = [];
  let groupKey: string | null = null;

  const flush = () => {
    if (group.length > 0) out.push(...shuffle(group, rng));
    group = [];
  };

  for (const item of sorted) {
    const k = keyOf(item);
    if (k !== groupKey) {
      flush();
      groupKey = k;
    }
    group.push(item);
  }
  flush();
  return out;
}

/** tier内の並び（docs/spec.md §5-3）。tierごとにソートキーが違う */
function orderWithinTier(
  tier: Tier,
  entries: readonly WordEntry[],
  cards: CardMap,
  wordStats: WordStatMap,
  rng: Rng,
): WordEntry[] {
  if (tier === 1) {
    // ソートキーなし。全体をシャッフルしてよい
    return shuffle(entries, rng);
  }

  if (tier === 0) {
    // missCount 降順 → updatedAt 昇順 → 同値の中だけシャッフル
    const sorted = [...entries].sort((a, b) => {
      const ca = cards[idKey(a.id)];
      const cb = cards[idKey(b.id)];
      if (cb.missCount !== ca.missCount) return cb.missCount - ca.missCount;
      return ca.updatedAt - cb.updatedAt;
    });
    return shuffleWithinTies(
      sorted,
      (e) => {
        const c = cards[idKey(e.id)];
        return `${c.missCount}:${c.updatedAt}`;
      },
      rng,
    );
  }

  // tier 2: lastSeenAt 昇順 → 同値の中だけシャッフル
  const sorted = [...entries].sort(
    (a, b) => wordStats[idKey(a.id)].lastSeenAt - wordStats[idKey(b.id)].lastSeenAt,
  );
  return shuffleWithinTies(
    sorted,
    (e) => String(wordStats[idKey(e.id)].lastSeenAt),
    rng,
  );
}

/** tier順（0 → 1 → 2）に並べ、各tier内は上記の規則で並べる */
function candidatesInOrder(
  entries: readonly WordEntry[],
  cards: CardMap,
  wordStats: WordStatMap,
  rng: Rng,
): WordEntry[] {
  const buckets: Record<Tier, WordEntry[]> = { 0: [], 1: [], 2: [] };
  for (const e of entries) buckets[tierOf(e, cards, wordStats)].push(e);

  return [
    ...orderWithinTier(0, buckets[0], cards, wordStats, rng),
    ...orderWithinTier(1, buckets[1], cards, wordStats, rng),
    ...orderWithinTier(2, buckets[2], cards, wordStats, rng),
  ];
}

export function buildSession(
  input: {
    wordlist: Wordlist;
    cards: CardMap;
    wordStats: WordStatMap;
    questionCount?: number;
  },
  rng: Rng,
): Question[] {
  const { wordlist, cards, wordStats } = input;
  const total = input.questionCount ?? QUESTIONS_PER_SESSION;
  const slots = allocateLevelSlots(total);

  const usedWordKeys = new Set<string>();
  const usedIds = new Set<number>();
  const picked: Question[] = [];

  const tryTake = (e: WordEntry): boolean => {
    if (usedIds.has(e.id)) return false;
    // ★セッション内 word 重複禁止。重複を許して埋めることは絶対にしない
    if (usedWordKeys.has(e.wordKey)) return false;
    const choices = buildChoices(e, wordlist.entries, rng);
    if (choices === null) return false;
    usedIds.add(e.id);
    usedWordKeys.add(e.wordKey);
    picked.push({ entry: e, choices });
    return true;
  };

  // S3: L1 → L2 → L3 の順（L1は40語で最も枯渇しやすいので先に確保）
  let deficit = 0;
  for (const level of LEVELS) {
    const pool = wordlist.byLevel.get(level) ?? [];
    const ordered = candidatesInOrder(pool, cards, wordStats, rng);
    let filled = 0;
    for (const e of ordered) {
      if (filled >= slots[level]) break;
      if (tryTake(e)) filled += 1;
    }
    deficit += slots[level] - filled;
  }

  // S4: 補充パス。L3 → L2 → L1 の順（プールが大きく目標帯であるL3から埋める）
  if (deficit > 0) {
    for (const level of [...LEVELS].reverse()) {
      if (deficit <= 0) break;
      const pool = wordlist.byLevel.get(level) ?? [];
      const ordered = candidatesInOrder(pool, cards, wordStats, rng);
      for (const e of ordered) {
        if (deficit <= 0) break;
        if (tryTake(e)) deficit -= 1;
      }
    }
  }

  // S6: 出題順をシャッフル（レベル順に並ばないように）
  return shuffle(picked, rng);
}

export function maxScore(questionCount: number): number {
  return questionCount * POINTS.instantCorrect;
}

export function scoreAnswer(a: AnsweredQuestion): number {
  if (!a.isCorrect) return POINTS.wrong;
  return a.isInstant ? POINTS.instantCorrect : POINTS.slowCorrect;
}

export function summarize(answers: readonly AnsweredQuestion[]): SessionSummary {
  const questionCount = answers.length;
  const score = answers.reduce((acc, a) => acc + scoreAnswer(a), 0);
  const correct = answers.filter((a) => a.isCorrect).length;
  const instant = answers.filter((a) => a.isCorrect && a.isInstant).length;

  const causeCounts: Record<Cause, number> = {
    pos_mismatch: 0,
    weak_memory: 0,
    hesitant: 0,
  };
  for (const a of answers) {
    if (a.cause !== null) causeCounts[a.cause] += 1;
  }

  return {
    questionCount,
    score,
    maxScore: maxScore(questionCount),
    accuracyRate: questionCount === 0 ? 0 : correct / questionCount,
    instantRate: questionCount === 0 ? 0 : instant / questionCount,
    causeCounts,
  };
}
