/**
 * AI応答の JSON Schema（docs/spec.md §10-3 の転記）。
 *
 * 制約（§10-1）:
 * - 全オブジェクトに additionalProperties: false が必要
 * - maxLength / minLength / maxItems / minimum / maximum は非対応
 *   → 枚数と文字数はプロンプト本文で指示し、アプリ側でも担保する（§10-5 V5/V6・§10-10）
 * - enum と anyOf は使える
 *
 * cause_label は含めない（2026-08-16 の決定。§10-9）。
 * cause から一意に決まる値なのでAIに生成させず、アプリ側が決定して CardContent に格納する。
 */

export const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["pattern_summary", "review_cards", "next_message", "suggested_tempo"],
  properties: {
    pattern_summary: { type: "string" },
    review_cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "word",
          "explanation",
          "usage_note",
          "example_en",
          "example_ja",
        ],
        properties: {
          id: { type: "integer" },
          word: { type: "string" },
          explanation: { type: "string" },
          usage_note: { type: "string" },
          example_en: { type: "string" },
          example_ja: { type: "string" },
        },
      },
    },
    next_message: { type: "string" },
    // ★4値 enum ＋ 必須。「省略できる」形にすると、省略が意図的だったのか
    //   出力漏れだったのか区別できない。変更不要なら "none" を明示させる（§10-3）
    suggested_tempo: { type: "string", enum: ["slow", "normal", "fast", "none"] },
  },
};
