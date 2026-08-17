/**
 * 回答列 → ScoreStrip の目盛り列（docs/spec.md §13-8）。
 *
 * quiz（途中）・result（確定）・home（前回セット）の3画面が同じ図を出すので、
 * 導出をここ1箇所に閉じる。**画面側で marks を組み立てない。**
 *
 * ★ここは「見え方」への変換であり、得点の計算ではない。
 *   得点は session.ts の scoreAnswer / summarize が持つ。
 *   高さと点数の対応（20px=10点 / 10px=5点 / 3px=0点）は §13-8 の表が正典。
 */
import type { AnsweredQuestion, ScoreMark, SessionRecord } from "./types";

/** 回答済み1問の見え方。誤答と無回答は畳む（§13-8 の表で同じ行） */
function markOf(a: AnsweredQuestion): ScoreMark {
  if (!a.isCorrect) return "wrong";
  return a.isInstant ? "instant" : "correct";
}

/**
 * 必ず questionCount 本を返す。足りない分は "unanswered"（枠のみ）で埋める。
 *
 * 本数＝出題数という読み方を崩さないため、answers が questionCount を超えていても
 * 切り詰める。起きてはいけない状態だが、起きたときに11本描いて図が崩れるより
 * 10本で止まるほうが安全。
 */
export function toScoreMarks(
  answers: readonly AnsweredQuestion[],
  questionCount: number,
): ScoreMark[] {
  return Array.from({ length: questionCount }, (_, i) => {
    const a = answers[i];
    return a === undefined ? "unanswered" : markOf(a);
  });
}

/**
 * 保存済みセッションから目盛りを復元する（home の「前回」用）。
 *
 * ★これは本数だけの復元であり、位置＝問番号ではない（docs/spec.md §13-8）。
 *   `SessionRecord` は1問ごとの結果を持たないため、並び順は復元できない。
 *   並びは 即答 → 迷い → 誤答 に固定する。
 *
 * ★1問ごとの結果を持たせる案（SessionRecord.marks）は見送った（2026-08-17）。
 *   home の目盛りは「前回どうだったか」の要約であって、
 *   1問ごとの復習をする場所ではない。復習は /review が持つ。
 *
 * 端数の扱い：即答本数を四捨五入で決め、正解本数も四捨五入で決めたうえで、
 * 誤答は**引き算で出す**。こうすると本数の合計が必ず questionCount に一致する。
 */
export function restoreScoreMarks(record: SessionRecord): ScoreMark[] {
  const n = record.questionCount;
  if (n <= 0) return [];

  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v));

  const instant = clamp(Math.round(record.instantRate * n), 0, n);
  const correctTotal = clamp(Math.round(record.accuracyRate * n), instant, n);
  const hesitant = correctTotal - instant;
  const wrong = n - instant - hesitant;

  return [
    ...Array<ScoreMark>(instant).fill("instant"),
    ...Array<ScoreMark>(hesitant).fill("correct"),
    ...Array<ScoreMark>(wrong).fill("wrong"),
  ];
}
