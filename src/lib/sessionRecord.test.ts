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

describe("markSessionAiReady", () => {
  it("先頭のレコードだけを ready にする", () => {
    const sessions = [record({ finishedAt: 3 }), record({ finishedAt: 2 })];
    const out = markSessionAiReady(sessions);

    expect(out[0]?.aiStatus).toBe("ready");
    expect(out[1]?.aiStatus).toBe("pending");
  });

  it("空配列でも落ちない", () => {
    expect(markSessionAiReady([])).toEqual([]);
  });

  it("入力を変更しない（純関数）", () => {
    const sessions = [record()];
    markSessionAiReady(sessions);

    expect(sessions[0]?.aiStatus).toBe("pending");
  });

  it("すでに ready のときは変わらない", () => {
    const out = markSessionAiReady([record({ aiStatus: "ready" })]);

    expect(out[0]?.aiStatus).toBe("ready");
  });
});
