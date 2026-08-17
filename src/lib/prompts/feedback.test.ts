import { describe, expect, it } from "vitest";
import {
  buildFeedbackPrompt,
  MAX_REVIEW_CARDS,
  selectCardTargets,
} from "@/lib/prompts/feedback";
import type { Cause, FeedbackRequest, Level } from "@/lib/types";

/**
 * なぜテストすべきか：
 * LLM の出力はテストできないが「何を渡しているか」はテストできる。
 * 評価項目1（プロンプト設計力）が最重要なので、ここは純関数として固める。
 *
 * とくに「渡さないものが含まれない」は重要。日付・localStorage 全体・
 * セッション履歴・個人情報の混入を、実際の文字列で確認する（spec.md §10-2）。
 */

const result = (
  id: number,
  over: Partial<FeedbackRequest["results"][number]> = {},
): FeedbackRequest["results"][number] => ({
  id,
  word: `word${id}`,
  pos: "動詞",
  level: 2 as Level,
  meaning: `意味${id}`,
  similar: [`sim${id}a`, `sim${id}b`],
  example_scene: `場面${id}`,
  selected_meaning: null,
  is_correct: true,
  is_instant: true,
  response_ms: 1000,
  cause: null,
  ...over,
});

const pendingItem = (
  id: number,
  over: Partial<FeedbackRequest["pending"][number]> = {},
): FeedbackRequest["pending"][number] => ({
  id,
  word: `pend${id}`,
  pos: "名詞",
  level: 3 as Level,
  meaning: `保留意味${id}`,
  similar: [`psim${id}`],
  example_scene: `保留場面${id}`,
  cause: "weak_memory" as Cause,
  ...over,
});

const req = (over: Partial<FeedbackRequest> = {}): FeedbackRequest => ({
  session: {
    tempo: "normal",
    tempoLabel: "ふつう",
    instantThresholdMs: 5000,
    questionCount: 10,
    score: 72,
    maxScore: 100,
    accuracyRate: 0.9,
    instantRate: 0.54,
    causeCounts: { pos_mismatch: 3, weak_memory: 1, hesitant: 2 },
  },
  results: [],
  pending: [],
  ...over,
});

/** 誤答（cause あり） */
const wrong = (id: number, cause: Cause = "pos_mismatch") =>
  result(id, {
    is_correct: false,
    is_instant: false,
    selected_meaning: "選んだ意味",
    cause,
  });

/** 非即答正解 */
const hesitant = (id: number) =>
  result(id, { is_correct: true, is_instant: false, cause: "hesitant" });

describe("selectCardTargets", () => {
  it("優先順位は pending → 今回の誤答 → 今回の非即答正解", () => {
    // なぜ：spec.md §10-10。pending を先に消化しないとバックログが累積する
    const targets = selectCardTargets(
      req({
        results: [hesitant(20), wrong(10)],
        pending: [pendingItem(1)],
      }),
    );
    expect(targets.map((t) => t.id)).toEqual([1, 10, 20]);
    expect(targets.map((t) => t.source)).toEqual(["pending", "wrong", "hesitant"]);
  });

  it("上限5件。6件以上の候補があっても5件に絞る", () => {
    // なぜ：15枚生成はレイテンシが読めず analyzing 待機が長くなる（spec.md §10-10）
    const targets = selectCardTargets(
      req({ results: [10, 11, 12, 13, 14, 15, 16].map((id) => wrong(id)) }),
    );
    expect(targets).toHaveLength(MAX_REVIEW_CARDS);
    expect(MAX_REVIEW_CARDS).toBe(5);
  });

  it("pending が5件あるとき、今回の誤答は入らない", () => {
    // なぜ：優先順位の帰結。上限に達した時点で打ち切る（spec.md §10-10）
    const targets = selectCardTargets(
      req({
        results: [wrong(10), wrong(11)],
        pending: [1, 2, 3, 4, 5].map((id) => pendingItem(id)),
      }),
    );
    expect(targets).toHaveLength(5);
    expect(targets.map((t) => t.id)).toEqual([1, 2, 3, 4, 5]);
    expect(targets.every((t) => t.source === "pending")).toBe(true);
  });

  it("即答で正解した語は対象に入らない（cause が null）", () => {
    // なぜ：復習対象は2カテゴリのみ（spec.md §10-6）。
    //       即答正解を含めるとカードが増え続け、③の「減っていく実感」が壊れる
    const targets = selectCardTargets(
      req({ results: [result(10), result(11), wrong(12)] }),
    );
    expect(targets.map((t) => t.id)).toEqual([12]);
  });
});

describe("buildFeedbackPrompt", () => {
  const sample = () =>
    req({
      results: [wrong(10), hesitant(20), result(30)],
      pending: [pendingItem(1)],
    });

  it("禁止事項の文言が含まれる", () => {
    // なぜ：spec.md §10-8。汎用的な励ましと一般論を禁じるのが
    //       「自分のための言葉だ」と感じさせる前提（評価項目2）
    const p = buildFeedbackPrompt(sample());
    expect(p).toContain("頑張りましょう");
    expect(p).toContain("一般論");
  });

  it("causeCounts が含まれる（AIに数えさせない）", () => {
    // なぜ：spec.md §10-2。数え間違いは pattern_summary の説得力を直撃する
    const p = buildFeedbackPrompt(sample());
    expect(p).toContain("品詞の取り違え: 3件");
    expect(p).toContain("意味の記憶があいまい: 1件");
    expect(p).toContain("思い出すのに時間がかかった: 2件");
  });

  /**
   * ★2026-08-17 実機で pattern_summary に「（hesitant）」が出た。
   *   原因は formatTarget と内訳が cause の内部値をそのまま渡していたこと。
   *   日本語ラベルで渡すのが本修正で、禁止事項の明示は二重の歯止め。
   *
   * ここで「プロンプト全体に内部値が無い」とは検査できない。
   * 禁止事項の文中に対象の文字列そのものを書いているため。
   * だからデータを渡している箇所を名指しで検査する。
   */
  it("cause を内部値のまま渡さない（日本語ラベルで渡す）", () => {
    const p = buildFeedbackPrompt(sample());

    expect(p).toContain("確定した原因: 品詞の取り違え");
    expect(p).not.toContain("確定した原因: pos_mismatch");
    expect(p).not.toContain("確定した原因: weak_memory");
    expect(p).not.toContain("確定した原因: hesitant");
    // 内訳の行に内部値を併記しない
    expect(p).not.toContain("pos_mismatch（品詞の取り違え）");
  });

  it("内部値を出力に含めるなという指示がある", () => {
    const p = buildFeedbackPrompt(sample());
    expect(p).toContain("出力に含めない");
  });

  /**
   * ★2026-08-17 のモデル比較で発覚（docs/data-findings.md §9）。
   *   Sonnet 5 の explanation に「閾値の5000ms」と内部の単位が出た。
   *   ms はアプリの内部表現であって、鈴木さんが読む単位ではない。
   *   cause の内部値を排除したのと同じ趣旨。
   */
  it("即答の閾値を秒で渡す（ミリ秒の内部表現を渡さない）", () => {
    const p = buildFeedbackPrompt(sample()); // instantThresholdMs: 5000

    expect(p).toContain("5秒");
    expect(p).not.toContain("5000ms");
    expect(p).not.toContain("5000 ms");
    expect(p).not.toContain("5000ミリ秒");
  });

  it("3つのテンポの閾値をすべて秒に変換する", () => {
    const at = (ms: number) =>
      buildFeedbackPrompt(req({ session: { ...req().session, instantThresholdMs: ms } }));

    expect(at(8000)).toContain("8秒");
    expect(at(5000)).toContain("5秒");
    expect(at(3000)).toContain("3秒");
  });

  it("1000で割り切れない値は小数1桁までにする（末尾の .0 を作らない）", () => {
    const at = (ms: number) =>
      buildFeedbackPrompt(req({ session: { ...req().session, instantThresholdMs: ms } }));

    expect(at(4500)).toContain("4.5秒");
    expect(at(2000)).toContain("2秒");
    expect(at(2000)).not.toContain("2.0秒");
  });

  it("秒で答えるよう出力側にも指示する", () => {
    const p = buildFeedbackPrompt(sample());
    expect(p).toContain("ミリ秒");
  });

  it("対象語の similar が含まれる", () => {
    // なぜ：usage_note（使い分け説明）の材料。課題①への答え（spec.md §10-9）
    const p = buildFeedbackPrompt(sample());
    expect(p).toContain("sim10a");
  });

  it("対象語の example_scene が含まれる", () => {
    // なぜ：example_en（ビジネス文脈の例文）の材料（spec.md §10-9）
    const p = buildFeedbackPrompt(sample());
    expect(p).toContain("場面10");
  });

  it("「最大5枚」の指示が含まれる", () => {
    // なぜ：maxItems が使えないため、プロンプト本文が枚数制御の一方の担保
    //       （spec.md §10-10。もう一方は aiResponse の slice）
    const p = buildFeedbackPrompt(sample());
    expect(p).toContain("5");
    expect(p).toMatch(/最大|以内|超えない/);
  });

  it("★渡さないものが含まれない（日付・履歴・localStorage）", () => {
    // なぜ：spec.md §10-2「渡さないもの：日付、localStorage 全体、
    //       セッション履歴、個人情報」。混入を実際の文字列で確認する
    const p = buildFeedbackPrompt(sample());
    expect(p).not.toMatch(/\d{4}-\d{2}-\d{2}/); // ISO日付
    expect(p).not.toContain("english700:"); // localStorage のキー接頭辞
    expect(p).not.toContain("localStorage");
    expect(p).not.toContain("sessions");
    expect(p).not.toContain("finishedAt");
    expect(p).not.toContain("lastSeenAt");
  });

  it("同じ入力なら同じ文字列を返す（純関数）", () => {
    // なぜ：Date.now() や Math.random() を内部で呼んでいたらここで落ちる。
    //       プロンプトが呼び出しごとに変わると、プロンプトキャッシュも再現性も壊れる
    const r = sample();
    expect(buildFeedbackPrompt(r)).toBe(buildFeedbackPrompt(r));
  });
});
