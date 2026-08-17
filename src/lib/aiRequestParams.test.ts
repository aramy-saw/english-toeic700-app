import { describe, expect, it } from "vitest";
import { buildMessageParams, MAX_TOKENS } from "./aiRequestParams";
import type { FeedbackRequest, Level } from "./types";

/**
 * ★何を API に渡しているかをテストする。
 *   Route Handler の中に直書きしていると型チェックしか効かない。
 *   純関数に切り出せば「思考を切っているか」「サンプリングを渡していないか」を
 *   文字列ではなくオブジェクトとして固定できる。AI の出力内容は一切見ない。
 */

const req = (): FeedbackRequest => ({
  session: {
    tempo: "normal",
    tempoLabel: "ふつう",
    instantThresholdMs: 5000,
    questionCount: 10,
    score: 30,
    maxScore: 100,
    accuracyRate: 0.4,
    instantRate: 0.2,
    causeCounts: { pos_mismatch: 1, weak_memory: 1, hesitant: 1 },
  },
  results: [
    {
      id: 1,
      word: "w1",
      pos: "名詞",
      level: 2 as Level,
      meaning: "m1",
      similar: ["a"],
      example_scene: "s",
      selected_meaning: null,
      is_correct: false,
      is_instant: false,
      response_ms: 1000,
      cause: "weak_memory",
    },
  ],
  pending: [],
});

describe("buildMessageParams", () => {
  /**
   * ★2026-08-18 に thinking を無効化した（spec.md §12-6 d）。
   *   15件で1枚目が 46.7秒 → 11.4秒（ローカル実測）。
   *   待ちの主因は生成量ではなく思考時間だった。
   */
  it("thinking を無効にして渡す", () => {
    expect(buildMessageParams(req(), "claude-sonnet-5").thinking).toEqual({
      type: "disabled",
    });
  });

  it("構造化出力のスキーマを渡す", () => {
    const p = buildMessageParams(req(), "claude-sonnet-5");
    expect(p.output_config?.format).toMatchObject({ type: "json_schema" });
  });

  it("★サンプリングパラメータを渡さない（非デフォルト値は400になる・§10-1）", () => {
    const p = buildMessageParams(req(), "claude-sonnet-5") as Record<string, unknown>;
    expect(p.temperature).toBeUndefined();
    expect(p.top_p).toBeUndefined();
    expect(p.top_k).toBeUndefined();
  });

  it("モデルと max_tokens を渡す", () => {
    const p = buildMessageParams(req(), "claude-haiku-4-5");
    expect(p.model).toBe("claude-haiku-4-5");
    expect(p.max_tokens).toBe(MAX_TOKENS);
  });

  it("プロンプト本文を1件のユーザーメッセージとして渡す", () => {
    const p = buildMessageParams(req(), "claude-sonnet-5");
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0]?.role).toBe("user");
    expect(typeof p.messages[0]?.content).toBe("string");
  });
});
