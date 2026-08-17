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
 * 指定したセッション（finishedAt で特定）の aiStatus を ready にする。
 *
 * ★2026-08-18 に「先頭を ready」から変更した（§12-6 c）。
 *   画面を離れても応答の受け取りを続けるようにしたため、
 *   応答が返ってきた時点で**別のセッションが先頭にいる**ことがありうる。
 *   先頭を書き換えると、AI が付いていないセッションを ready にしてしまう。
 *
 * finishedAt は Date.now() のミリ秒。同一クライアントで2セッションが
 * 同じミリ秒に終わることは無いので、これで一意に決まる。
 */
export function markSessionAiReady(
  sessions: readonly SessionRecord[],
  finishedAt: number,
): SessionRecord[] {
  return sessions.map((s) =>
    s.finishedAt === finishedAt ? { ...s, aiStatus: "ready" } : s,
  );
}
