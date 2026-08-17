import { describe, expect, it } from "vitest";
import {
  applyAiResponseToCards,
  validateAiResponse,
  validateStreamedCard,
  type ValidationContext,
} from "@/lib/aiResponse";
import { CAUSE_LABEL } from "@/lib/diagnosis";
import { idKey } from "@/lib/ids";
import type {
  AiReviewCard,
  CardMap,
  FeedbackResponse,
  ReviewCard,
  WordEntry,
  WordId,
} from "@/lib/types";

/**
 * なぜテストすべきか：
 * ここが「AIを信用しない層」。AIの幻覚（出題していない語を返す）を
 * 構造的に止める最後の砦であり、通り抜けると鈴木さんが見たことのない語の
 * 説明を読まされる。LLM の文章の中身はテストしないが、この層はテストする。
 */

const entry = (id: number, word: string): WordEntry => ({
  id,
  word,
  wordKey: word.toLowerCase(),
  posRaw: "動詞",
  pos: "verb",
  posAll: ["verb"],
  meaning: `意味${id}`,
  meaningParts: [`意味${id}`],
  level: 2,
  exampleScene: `場面${id}`,
  similar: [],
  isCustom: false,
});

const card = (id: number, over: Partial<ReviewCard> = {}): ReviewCard => ({
  id,
  word: `word${id}`,
  meaning: `意味${id}`,
  level: 2,
  cause: "weak_memory",
  state: "pending",
  missCount: 1,
  hesitantCount: 0,
  createdAt: 1000,
  updatedAt: 1000,
  content: null,
  ...over,
});

const aiCard = (id: number, over: Partial<AiReviewCard> = {}): AiReviewCard => ({
  id,
  word: `word${id}`,
  explanation: `説明${id}`,
  usage_note: `使い分け${id}`,
  example_en: `Example ${id}.`,
  example_ja: `例文${id}。`,
  ...over,
});

const response = (over: Partial<FeedbackResponse> = {}): FeedbackResponse => ({
  pattern_summary: "今日は品詞の取り違えが3回。",
  review_cards: [aiCard(10)],
  next_message: "次回もこの調子で。",
  suggested_tempo: "none",
  ...over,
});

const ctx = (
  ids: WordId[],
  over: Partial<ValidationContext> = {},
): ValidationContext => ({
  presentedIds: ids,
  byId: new Map(ids.map((id) => [id, entry(id, `word${id}`)])),
  currentTempo: "normal",
  accuracyRate: 0.9,
  instantRate: 0.5,
  ...over,
});

describe("validateAiResponse", () => {
  it("V1：パース不能・スキーマ形状違反は全体エラー", () => {
    // なぜ：構造が壊れたまま先に進むと、後段が undefined を触って落ちる
    expect(validateAiResponse("これはJSONではない", ctx([10])).ok).toBe(false);
    expect(validateAiResponse({ review_cards: "配列ではない" }, ctx([10])).ok).toBe(
      false,
    );
    expect(validateAiResponse(null, ctx([10])).ok).toBe(false);
  });

  it("V2：presented に無い id は全体エラー", () => {
    // なぜ：AIの幻覚を構造的に防ぐ。出題していない語の説明を読ませない（spec.md §10-5）
    const r = validateAiResponse(response({ review_cards: [aiCard(999)] }), ctx([10]));
    expect(r.ok).toBe(false);
  });

  it("V2：word が byId と不一致なら全体エラー", () => {
    // なぜ：id と word がずれていたら、どちらを信じてよいか分からない。
    //       mutual(192)/mutual(279) のような重複語で誤ったカードを作らないため
    const r = validateAiResponse(
      response({ review_cards: [aiCard(10, { word: "ちがう語" })] }),
      ctx([10]),
    );
    expect(r.ok).toBe(false);
  });

  it("V3：復習対象が全部揃っていなくても ok", () => {
    // なぜ：spec.md §10-5 V3。欠けた語は pending のまま残り次回埋まる。
    //       ここで厳しくすると、1語欠けただけで全部が pending に落ちる
    const r = validateAiResponse(
      response({ review_cards: [aiCard(10)] }),
      ctx([10, 11, 12]),
    );
    expect(r.ok).toBe(true);
  });

  it("V4：条件を満たさない suggested_tempo は捨てるが、全体は ok", () => {
    // なぜ：spec.md §10-4。AIの提案をアプリが数値条件で再計算して検証する。
    //       満たさなければ黙って捨てる（レスポンス全体は捨てない）
    const r = validateAiResponse(
      response({ suggested_tempo: "fast" }),
      // 即答率0.2 は "fast" 提案の条件（≥0.8）を満たさない
      ctx([10], { instantRate: 0.2, accuracyRate: 0.9 }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.response.suggested_tempo).toBe("none");
  });

  it("★V6 撤廃：6枚返ってきたら6枚とも通す（2026-08-18・§10-10）", () => {
    // 上限で切ると、切られた語に説明が付かないまま残る。
    // 幻覚は V2（id の検査）で防ぐので、枚数で防ぐ必要はない
    const ids = [10, 11, 12, 13, 14, 15];
    const r = validateAiResponse(
      response({ review_cards: ids.map((id) => aiCard(id)) }),
      ctx(ids),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.response.review_cards).toHaveLength(6);
  });

  it("★6枚目に不正な id があれば、切る前に全体エラーになる（V2 → slice の順）", () => {
    // なぜ：spec.md §10-5 の順序決定そのもの。slice を先にすると
    //       切り捨てられる範囲の不正な id が検出されず素通りする。
    //       検証の意図（幻覚を構造的に防ぐ）に穴を開けないための固定
    const ids = [10, 11, 12, 13, 14];
    const r = validateAiResponse(
      response({ review_cards: [...ids.map((id) => aiCard(id)), aiCard(999)] }),
      ctx(ids),
    );
    expect(r.ok).toBe(false);
  });
});

describe("applyAiResponseToCards", () => {
  it("cause_label がアプリ側の固定文言で入る", () => {
    // なぜ：spec.md §10-9。AIに生成させると呼び出しごとに文言が揺れて
    //       同じ原因が別物に見える。スキーマからも外してある
    const cards: CardMap = { [idKey(10)]: card(10, { cause: "pos_mismatch" }) };
    const out = applyAiResponseToCards(cards, response(), 2000);
    expect(out[idKey(10)].content?.causeLabel).toBe(CAUSE_LABEL.pos_mismatch);
    expect(out[idKey(10)].content?.causeLabel).toBe("品詞の取り違え");
  });

  it("state が ready になる", () => {
    // なぜ：spec.md §11 の遷移「AI応答が検証を通り、その id を含む」→ ready
    const cards: CardMap = { [idKey(10)]: card(10) };
    const out = applyAiResponseToCards(cards, response(), 2000);
    expect(out[idKey(10)].state).toBe("ready");
    expect(out[idKey(10)].content?.explanation).toBe("説明10");
    expect(out[idKey(10)].content?.filledAt).toBe(2000);
  });

  it("対象外のカードは pending のまま残る", () => {
    // なぜ：spec.md §10-5 V3。今回埋まらなかった語は次回の呼び出しで埋まる
    const cards: CardMap = {
      [idKey(10)]: card(10),
      [idKey(11)]: card(11),
    };
    const out = applyAiResponseToCards(cards, response(), 2000);
    expect(out[idKey(11)].state).toBe("pending");
    expect(out[idKey(11)].content).toBeNull();
  });

  it("★cards に存在しない id は無視する（新規カードを作らない）", () => {
    // なぜ：presented には即答正解した語の id も含まれる（spec.md §10-5）。
    //       その語のカードは卒業済み。ここで新規作成すると卒業が取り消され、
    //       覚えた語が復習に戻ってくる。学習ループとして誤り
    const cards: CardMap = { [idKey(10)]: card(10) };
    const out = applyAiResponseToCards(
      cards,
      response({ review_cards: [aiCard(10), aiCard(99)] }),
      2000,
    );
    expect(Object.keys(out)).toHaveLength(1);
    expect(out[idKey(99)]).toBeUndefined();
  });
});

/**
 * ★ストリーミング中の1枚単位の検証（2026-08-18・§10-5）。
 *   全件そろう前に表示するので、V2（幻覚）と V5（文字数）を**1枚ずつ**適用する。
 *   最終的な全体検証（V1〜V5）は完了時に別途走り、そちらが正典。
 */
describe("validateStreamedCard", () => {
  it("出題した id なら通る", () => {
    const card = validateStreamedCard(aiCard(10), ctx([10, 11]));
    expect(card?.id).toBe(10);
  });

  it("★出題していない id は捨てる（幻覚を1枚単位でも防ぐ）", () => {
    expect(validateStreamedCard(aiCard(999), ctx([10, 11]))).toBeNull();
  });

  it("形が不正なら捨てる", () => {
    expect(validateStreamedCard({ id: 10 }, ctx([10]))).toBeNull();
    expect(validateStreamedCard(null, ctx([10]))).toBeNull();
    expect(validateStreamedCard("x", ctx([10]))).toBeNull();
  });

  it("文字数の上限で切る（V5）", () => {
    const long = { ...aiCard(10), explanation: "あ".repeat(400) };
    const card = validateStreamedCard(long, ctx([10]));
    expect(card?.explanation).toHaveLength(300);
  });
});
