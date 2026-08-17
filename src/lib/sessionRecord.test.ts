import { describe, expect, it } from "vitest";
import { buildSessionRecord, markSessionAiReady } from "./sessionRecord";
import type { AnsweredQuestion, Question, SessionRecord, WordEntry } from "./types";

function answered(isCorrect: boolean, isInstant: boolean): AnsweredQuestion {
  const entry = { id: 1, word: "w" } as unknown as WordEntry;
  return {
    question: { entry, choices: [] } as unknown as Question,
    selectedChoiceId: isCorrect ? "c" : null,
    responseMs: 1000,
    isCorrect,
    isInstant,
    cause: null,
  };
}

const NOW = 1_700_000_000_000;

describe("buildSessionRecord", () => {
  it("summarize と同じ集計値を持つ", () => {
    const rec = buildSessionRecord({
      answers: [
        answered(true, true),
        answered(true, false),
        answered(false, false),
        answered(false, false),
      ],
      tempo: "normal",
      finishedAt: NOW,
      dateLabel: "2026-08-17",
    });

    expect(rec.score).toBe(15);
    expect(rec.maxScore).toBe(40);
    expect(rec.questionCount).toBe(4);
    expect(rec.accuracyRate).toBeCloseTo(0.5);
    expect(rec.instantRate).toBeCloseTo(0.25);
  });

  it("★テンポをスコアと対で保存する（後から解釈できなくなるため）", () => {
    const rec = buildSessionRecord({
      answers: [answered(true, true)],
      tempo: "fast",
      finishedAt: NOW,
      dateLabel: "2026-08-17",
    });

    expect(rec.tempo).toBe("fast");
  });

  it("★aiStatus は必ず pending で作る（AI を待たずに書くため）", () => {
    const rec = buildSessionRecord({
      answers: [answered(true, true)],
      tempo: "normal",
      finishedAt: NOW,
      dateLabel: "2026-08-17",
    });

    expect(rec.aiStatus).toBe("pending");
  });

  it("dateLabel は渡された値をそのまま持つ（ここで日付を作らない）", () => {
    const rec = buildSessionRecord({
      answers: [answered(true, true)],
      tempo: "normal",
      finishedAt: NOW,
      dateLabel: "2026-01-05",
    });

    expect(rec.dateLabel).toBe("2026-01-05");
    expect(rec.finishedAt).toBe(NOW);
  });
});

function record(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    finishedAt: NOW,
    dateLabel: "2026-08-17",
    tempo: "normal",
    score: 80,
    maxScore: 100,
    questionCount: 10,
    accuracyRate: 0.9,
    instantRate: 0.7,
    aiStatus: "pending",
    ...over,
  };
}

/**
 * ★2026-08-18 に「先頭を ready」から「finishedAt で特定して ready」に変えた。
 *   画面を離れてもストリームを続けるようにしたため（spec.md §12-6 c）、
 *   応答が返ってきた時点で**別のセッションが先頭にいる**ことがありうる。
 *   先頭を書き換えると、関係のないセッションを ready にしてしまう。
 */
describe("markSessionAiReady", () => {
  it("finishedAt が一致するレコードだけを ready にする", () => {
    const sessions = [record({ finishedAt: 3 }), record({ finishedAt: 2 })];
    const out = markSessionAiReady(sessions, 2);

    expect(out[0]?.aiStatus).toBe("pending");
    expect(out[1]?.aiStatus).toBe("ready");
  });

  it("★別のセッションが先頭に来ていても、取り違えない", () => {
    // 「もう1セット」を始めた後に前回の応答が返ってきた場合
    const sessions = [record({ finishedAt: 100 }), record({ finishedAt: 50 })];
    const out = markSessionAiReady(sessions, 50);

    expect(out[0]?.aiStatus).toBe("pending");
    expect(out[1]?.aiStatus).toBe("ready");
  });

  it("一致するものが無ければ何も変えない", () => {
    const out = markSessionAiReady([record({ finishedAt: 3 })], 999);
    expect(out[0]?.aiStatus).toBe("pending");
  });

  it("空配列でも落ちない", () => {
    expect(markSessionAiReady([], 1)).toEqual([]);
  });

  it("入力を変更しない（純関数）", () => {
    const sessions = [record({ finishedAt: 7 })];
    markSessionAiReady(sessions, 7);

    expect(sessions[0]?.aiStatus).toBe("pending");
  });

  it("すでに ready のときは変わらない", () => {
    const out = markSessionAiReady([record({ finishedAt: 7, aiStatus: "ready" })], 7);

    expect(out[0]?.aiStatus).toBe("ready");
  });
});
