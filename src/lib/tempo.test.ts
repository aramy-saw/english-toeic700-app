import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPO,
  isInstant,
  isNoAnswer,
  NO_ANSWER_TIMEOUT_MS,
  TEMPO_THRESHOLD_MS,
  tempoLabel,
} from "./tempo";

describe("isInstant", () => {
  it("閾値ちょうどは即答（docs/spec.md §7-1「超えた」の解釈）", () => {
    expect(isInstant(5000, "normal")).toBe(true);
  });

  it("閾値を1ms超えたら即答ではない", () => {
    expect(isInstant(5001, "normal")).toBe(false);
  });

  it("無回答（null）は即答ではない", () => {
    expect(isInstant(null, "fast")).toBe(false);
  });

  it("テンポごとに閾値が変わる", () => {
    expect(isInstant(4000, "slow")).toBe(true); // 8000 以下
    expect(isInstant(4000, "normal")).toBe(true); // 5000 以下
    expect(isInstant(4000, "fast")).toBe(false); // 3000 超
  });
});

/**
 * ★isNoAnswer は「即答判定」とは別物（docs/spec.md §7-1 の注記・§12-2）。
 *   テンポ閾値は強制打ち切りに使わない。無回答を作るのは
 *   NO_ANSWER_TIMEOUT_MS と「わからない」ボタンの2つだけ。
 *
 * ★タイマーで自動的に次へ進めるためのものではない。回答した瞬間に
 *   経過時間へ適用する上限である（通勤中の中断を誤答にしないため）。
 */
describe("isNoAnswer", () => {
  it("60秒ちょうどはまだ無回答ではない", () => {
    expect(isNoAnswer(NO_ANSWER_TIMEOUT_MS)).toBe(false);
  });

  it("60秒を1ms超えたら無回答", () => {
    expect(isNoAnswer(NO_ANSWER_TIMEOUT_MS + 1)).toBe(true);
  });

  it("通常の回答時間は無回答にならない", () => {
    expect(isNoAnswer(3200)).toBe(false);
  });

  it("テンポ閾値（最長でも 8000ms）では無回答にならない", () => {
    // 強制打ち切りにテンポ閾値を使っていないことの確認
    for (const ms of Object.values(TEMPO_THRESHOLD_MS)) {
      expect(isNoAnswer(ms)).toBe(false);
    }
  });
});

describe("tempoLabel", () => {
  it("初級・中級・上級とは呼ばない（配布データの level と混同するため）", () => {
    expect(tempoLabel("slow")).toBe("ゆっくり");
    expect(tempoLabel("normal")).toBe("ふつう");
    expect(tempoLabel("fast")).toBe("はやい");
  });

  it("既定テンポはふつう", () => {
    expect(DEFAULT_TEMPO).toBe("normal");
  });
});
