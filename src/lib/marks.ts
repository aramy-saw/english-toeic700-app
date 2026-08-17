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
import type { AnsweredQuestion, ScoreMark } from "./types";

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
