/**
 * セッション記録の組み立て（docs/spec.md §9-2・§12-5）。
 *
 * ★1セット＝1レコード。 2セットを合算すると200点満点になり、
 *   過去の100点満点レコードと比較できなくなる。
 *
 * ★時刻と日付はここで作らない。 呼び出し側（クライアント）が
 *   clock.ts の now() / todayJst() で作って渡す。
 *   Vercel は UTC なので、サーバー側で「今日」を計算すると1日ずれる（§12-4）。
 */
import { maxScore, summarize } from "./session";
import type { AnsweredQuestion, SessionRecord, TempoId } from "./types";

export function buildSessionRecord(input: {
  answers: readonly AnsweredQuestion[];
  tempo: TempoId;
  finishedAt: number;
  dateLabel: string;
}): SessionRecord {
  const s = summarize(input.answers);

  return {
    finishedAt: input.finishedAt,
    dateLabel: input.dateLabel,
    // ★テンポはスコアと必ず対で持つ。後から「70点」が速いのか遅いのか読めなくなる
    tempo: input.tempo,
    score: s.score,
    maxScore: maxScore(s.questionCount),
    questionCount: s.questionCount,
    accuracyRate: s.accuracyRate,
    instantRate: s.instantRate,
    /**
     * ★必ず pending で作る。
     *   このレコードは AI を待たずに quiz→analyzing の時点で書く（§12-2）。
     *   AI が成功したら markSessionAiReady で先頭を ready に更新する。
     */
    aiStatus: "pending",
  };
}

/**
 * 先頭（＝いま終わったセッション）の aiStatus を ready にする。
 *
 * 先頭で安全な理由：「もう1セット」を押した時点で前セットの応答は abort して
 * 捨てる（§12-6 c）ので、**次のセッションが始まった後に前回の AI が返ることはない。**
 */
export function markSessionAiReady(
  sessions: readonly SessionRecord[],
): SessionRecord[] {
  if (sessions.length === 0) return [];
  const [head, ...rest] = sessions;
  return head === undefined ? [] : [{ ...head, aiStatus: "ready" }, ...rest];
}
