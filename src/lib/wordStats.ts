/**
 * 未学習／出題済みの追跡（docs/spec.md §9-1・§9-2）。
 *
 * ★出題時ではなく回答確定時に書く。
 *   電車で中断されたセッションを「学習済み」にしないため。
 *   ここは AnsweredQuestion（＝回答が確定した語）だけを受け取るので、
 *   出題しただけの語が混ざる余地が構造的に無い。
 *
 * ★卒業判定はここではしない。 それは reviewCards.ts の担当。
 *   このファイルは回数を数えるだけで、何かを消したり作ったりしない。
 */
import { idKey } from "./ids";
import type { AnsweredQuestion, WordStat, WordStatMap } from "./types";

const EMPTY: WordStat = {
  seenCount: 0,
  correctCount: 0,
  instantCorrectCount: 0,
  lastSeenAt: 0,
};

/**
 * 1セッション分の回答を統計に積み上げる。
 * 入力の WordStatMap は変更せず、新しい WordStatMap を返す。
 */
export function applySessionToWordStats(
  wordStats: WordStatMap,
  answers: readonly AnsweredQuestion[],
  now: number,
): WordStatMap {
  const out: WordStatMap = { ...wordStats };

  for (const a of answers) {
    const key = idKey(a.question.entry.id);
    const prev = out[key] ?? EMPTY;

    out[key] = {
      seenCount: prev.seenCount + 1,
      correctCount: prev.correctCount + (a.isCorrect ? 1 : 0),
      // ★正解かつ即答のときだけ。誤答が速かっただけのものは数えない
      instantCorrectCount:
        prev.instantCorrectCount + (a.isCorrect && a.isInstant ? 1 : 0),
      lastSeenAt: now,
    };
  }

  return out;
}
