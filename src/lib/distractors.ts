/**
 * 誤答3つの生成。
 *
 * ブロックリストは5条件（docs/spec.md §6-1）。
 * フォールバックは例外処理ではなく通常フロー。実測で必ず発火する語が2つある:
 *   id=4  available     （形容詞・L1）… 誤答B が構成不能
 *   id=48 approximately （副詞・L2）  … 誤答B も C も構成不能
 */
import { shuffle } from "./shuffle";
import type { Cause, Choice, ChoiceRole, Rng, WordEntry } from "./types";

/** docs/spec.md §6-1 の5条件。1つでも当たれば誤答候補から除外する */
export function isBlocked(quiz: WordEntry, cand: WordEntry): boolean {
  // 1. 同じ id
  if (cand.id === quiz.id) return true;
  // 2. 同じ word（word重複26語対策。id ではなく word で判定）
  if (cand.wordKey === quiz.wordKey) return true;
  // 3. 出題語の similar に含まれる
  if (quiz.similar.includes(cand.wordKey)) return true;
  // 4. 候補の similar に出題語が含まれる／similar に共通語がある
  if (cand.similar.includes(quiz.wordKey)) return true;
  if (cand.similar.some((s) => quiz.similar.includes(s))) return true;
  // 5. meaning に共通要素がある（不良問題6組対策）
  if (cand.meaningParts.some((m) => quiz.meaningParts.includes(m))) return true;
  return false;
}

/**
 * 各役割のフォールバック段位（docs/spec.md §6-2）。
 * 添字が fallbackTier になる。0 が第1段。
 */
const TIERS: Readonly<
  Record<Exclude<ChoiceRole, "correct">, ((q: WordEntry, c: WordEntry) => boolean)[]>
> = {
  // 誤答A：異なる主要pos。実測300語すべてで第1段が非空
  A: [
    (q, c) => c.pos !== q.pos,
    () => true,
  ],
  // 誤答B：同pos・同level → levelを隣接帯に緩める → 複合品詞まで許す → 全体
  B: [
    (q, c) => c.pos === q.pos && c.level === q.level,
    (q, c) => c.pos === q.pos && Math.abs(c.level - q.level) === 1,
    (q, c) => c.posAll.some((p) => q.posAll.includes(p)) && c.level === q.level,
    () => true,
  ],
  // 誤答C：同pos・別level → levelの差を諦める → 複合品詞まで許す → 全体
  C: [
    (q, c) => c.pos === q.pos && c.level !== q.level,
    (q, c) => c.pos === q.pos,
    (q, c) => c.posAll.some((p) => q.posAll.includes(p)),
    () => true,
  ],
};

/** 役割ごとの cause。A を選んだら品詞の取り違え、B/C は記憶が薄い */
const CAUSE_OF: Readonly<Record<Exclude<ChoiceRole, "correct">, Cause>> = {
  A: "pos_mismatch",
  B: "weak_memory",
  C: "weak_memory",
};

type Picked = { entry: WordEntry; role: ChoiceRole; fallbackTier: number };

/**
 * 段位を上から順に試し、最初に候補が見つかった段からシャッフルして1件取る。
 * ★フォールバック段位が下がっても cause は役割で決まる（生成時に埋め込む）。
 */
function pickForRole(
  quiz: WordEntry,
  pool: readonly WordEntry[],
  role: Exclude<ChoiceRole, "correct">,
  taken: ReadonlySet<number>,
  takenMeanings: ReadonlySet<string>,
  rng: Rng,
): Picked | null {
  const tiers = TIERS[role];
  for (let tier = 0; tier < tiers.length; tier++) {
    const match = tiers[tier];
    const candidates = pool.filter(
      (c) => !taken.has(c.id) && !takenMeanings.has(c.meaning) && match(quiz, c),
    );
    if (candidates.length === 0) continue;
    const chosen = shuffle(candidates, rng)[0];
    return { entry: chosen, role, fallbackTier: tier };
  }
  return null;
}

/** 4件（正解1＋誤答3）をシャッフルして返す。組めなければ null */
export function buildChoices(
  quiz: WordEntry,
  pool: readonly WordEntry[],
  rng: Rng,
): Choice[] | null {
  const allowed = pool.filter((c) => !isBlocked(quiz, c));

  const taken = new Set<number>([quiz.id]);
  // 表示テキストの重複を防ぐ（4択の成立条件）
  const takenMeanings = new Set<string>([quiz.meaning]);
  const picked: Picked[] = [];

  for (const role of ["A", "B", "C"] as const) {
    const p = pickForRole(quiz, allowed, role, taken, takenMeanings, rng);
    if (p === null) return null;
    taken.add(p.entry.id);
    takenMeanings.add(p.entry.meaning);
    picked.push(p);
  }

  const correct: Choice = {
    choiceId: "",
    sourceId: quiz.id,
    text: quiz.meaning,
    isCorrect: true,
    causeIfChosen: null,
    role: "correct",
    fallbackTier: 0,
  };

  const wrong: Choice[] = picked.map((p) => ({
    choiceId: "",
    sourceId: p.entry.id,
    text: p.entry.meaning,
    isCorrect: false,
    causeIfChosen: CAUSE_OF[p.role as Exclude<ChoiceRole, "correct">],
    role: p.role,
    fallbackTier: p.fallbackTier,
  }));

  // 並びをシャッフルしてから choiceId を振る（正解の位置が偏らないように）
  return shuffle([correct, ...wrong], rng).map((c, i) => ({
    ...c,
    choiceId: `c${i}`,
  }));
}
