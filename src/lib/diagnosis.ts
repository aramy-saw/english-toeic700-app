/**
 * 原因（cause）の確定。
 * cause は選択肢の causeIfChosen を読むだけ。回答後に pos を再計算しない（docs/spec.md §6-3）。
 * 即答の閾値はテンポ設定で可変。
 */
import { isInstant } from "./tempo";
import type { Cause, Question, TempoId } from "./types";

export function diagnose(input: {
  question: Question;
  selectedChoiceId: string | null;
  responseMs: number | null;
  tempo: TempoId;
}): { isCorrect: boolean; isInstant: boolean; cause: Cause | null } {
  const { question, selectedChoiceId, responseMs, tempo } = input;

  const selected =
    selectedChoiceId === null
      ? null
      : (question.choices.find((c) => c.choiceId === selectedChoiceId) ?? null);

  const instant = isInstant(responseMs, tempo);

  // 無回答・タイムアウト（存在しない choiceId も同じ扱い）
  if (selected === null) {
    return { isCorrect: false, isInstant: false, cause: "weak_memory" };
  }

  if (selected.isCorrect) {
    // 正解かつ即答なら復習対象外。閾値を超えていれば hesitant
    return {
      isCorrect: true,
      isInstant: instant,
      cause: instant ? null : "hesitant",
    };
  }

  // 誤答。原因は生成時に選択肢へ埋め込んである
  return {
    isCorrect: false,
    isInstant: instant,
    cause: selected.causeIfChosen ?? "weak_memory",
  };
}

/**
 * cause の日本語表記（docs/spec.md §10-9 の固定文言）。
 * ★AIに生成させない。呼び出しごとに文言が揺れて同じ原因が別物に見えるため、
 *   レスポンススキーマからも外してある。
 */
export const CAUSE_LABEL: Readonly<Record<Cause, string>> = {
  pos_mismatch: "品詞の取り違え",
  weak_memory: "意味の記憶があいまい",
  hesitant: "思い出すのに時間がかかった",
};

export function causeLabel(cause: Cause): string {
  return CAUSE_LABEL[cause];
}
