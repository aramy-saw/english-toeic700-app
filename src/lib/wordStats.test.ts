import { describe, expect, it } from "vitest";
import { applySessionToWordStats } from "./wordStats";
import type { AnsweredQuestion, Question, WordEntry, WordStatMap } from "./types";

function answered(
  id: number,
  isCorrect: boolean,
  isInstant: boolean,
): AnsweredQuestion {
  const entry = { id, word: `w${id}` } as unknown as WordEntry;
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

describe("applySessionToWordStats", () => {
  it("未学習語には新しい WordStat を作る", () => {
    const out = applySessionToWordStats({}, [answered(1, true, true)], NOW);

    expect(out["1"]).toEqual({
      seenCount: 1,
      correctCount: 1,
      instantCorrectCount: 1,
      lastSeenAt: NOW,
    });
  });

  it("誤答は seenCount だけ増える", () => {
    const out = applySessionToWordStats({}, [answered(1, false, false)], NOW);

    expect(out["1"]).toEqual({
      seenCount: 1,
      correctCount: 0,
      instantCorrectCount: 0,
      lastSeenAt: NOW,
    });
  });

  it("正解だが即答でないものは instantCorrectCount が増えない", () => {
    const out = applySessionToWordStats({}, [answered(1, true, false)], NOW);

    expect(out["1"]?.correctCount).toBe(1);
    expect(out["1"]?.instantCorrectCount).toBe(0);
  });

  it("誤答なのに isInstant が true でも instantCorrectCount は増えない", () => {
    const out = applySessionToWordStats({}, [answered(1, false, true)], NOW);

    expect(out["1"]?.instantCorrectCount).toBe(0);
  });

  it("既存の統計に積み上げる", () => {
    const prev: WordStatMap = {
      "1": {
        seenCount: 3,
        correctCount: 2,
        instantCorrectCount: 1,
        lastSeenAt: 1,
      },
    };
    const out = applySessionToWordStats(prev, [answered(1, true, true)], NOW);

    expect(out["1"]).toEqual({
      seenCount: 4,
      correctCount: 3,
      instantCorrectCount: 2,
      lastSeenAt: NOW,
    });
  });

  it("入力の WordStatMap を変更しない（純関数）", () => {
    const prev: WordStatMap = {
      "1": {
        seenCount: 1,
        correctCount: 1,
        instantCorrectCount: 1,
        lastSeenAt: 1,
      },
    };
    applySessionToWordStats(prev, [answered(1, true, true)], NOW);

    expect(prev["1"]?.seenCount).toBe(1);
  });

  it("複数語をまとめて適用する", () => {
    const out = applySessionToWordStats(
      {},
      [answered(1, true, true), answered(2, false, false)],
      NOW,
    );

    expect(Object.keys(out).sort()).toEqual(["1", "2"]);
  });

  it("★出題しただけの語は含まれない（回答した語だけを書く）", () => {
    // 中断されたセッションを「学習済み」にしないため（docs/spec.md §9-1）。
    // answers に入るのは回答が確定した語だけなので、ここでは空入力を確認する
    expect(applySessionToWordStats({}, [], NOW)).toEqual({});
  });
});
