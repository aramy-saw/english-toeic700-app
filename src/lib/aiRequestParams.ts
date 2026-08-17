/**
 * Anthropic API に渡すパラメータの組み立て（docs/spec.md §10-1・§12-6 d）。
 *
 * ★Route Handler から切り出した理由。
 *   「思考を切っているか」「サンプリングを渡していないか」は、
 *   本番の挙動を決める重要な入力なのに、route に直書きだとテストできない。
 *   純関数にすれば固定できる。AI の出力内容はテストしない（CLAUDE.md のテスト境界）。
 */
import { buildFeedbackPrompt } from "./prompts/feedback";
import { RESPONSE_SCHEMA } from "./prompts/schema";
import type { FeedbackRequest } from "./types";

/**
 * thinking を切ったので、max_tokens は本文だけの上限になった。
 * 15件×4フィールドで実測 4,400字程度なので 8000 で足りる。
 */
export const MAX_TOKENS = 8000;

export type MessageParams = {
  model: string;
  max_tokens: number;
  thinking: { type: "disabled" };
  output_config: { format: { type: "json_schema"; schema: Record<string, unknown> } };
  messages: { role: "user"; content: string }[];
};

export function buildMessageParams(
  req: FeedbackRequest,
  model: string,
): MessageParams {
  return {
    model,
    max_tokens: MAX_TOKENS,

    /**
     * ★思考を切る（2026-08-18・§12-6 d）。
     *
     *   ローカル実測（対象15件）：
     *     thinking 既定 … 1枚目 46.7秒 / 全体 60.4秒
     *     thinking 無効 … 1枚目 11.4秒 / 全体 39.1秒
     *
     *   思考が終わるまで1文字も出ないため、切らないとストリーミングの意味がない。
     *   **待ちの主因は生成量ではなく思考時間だった。**
     *
     *   このアプリで AI がするのは「確定した原因を鈴木さんの言葉で説明する」だけで、
     *   原因の推定も件数の集計もアプリ側が済ませている（§10-8）。
     *   深い推論を要する仕事ではない、というのが切れる理由。
     */
    thinking: { type: "disabled" },

    // temperature / top_p / top_k は渡さない（非デフォルト値は400エラー。§10-1）
    output_config: {
      format: { type: "json_schema", schema: RESPONSE_SCHEMA },
    },
    messages: [{ role: "user", content: buildFeedbackPrompt(req) }],
  };
}
