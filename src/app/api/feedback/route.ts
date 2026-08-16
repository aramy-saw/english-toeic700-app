/**
 * フィードバック生成の Route Handler（docs/spec.md §10-7）。
 *
 * ★ここは薄く保つ。プロンプト本文の正典は src/lib/prompts/feedback.ts。
 *   本文をこのファイルに書かない。
 *
 * APIキーが未設定でも 500 を返さず「pending 方式に落とす」レスポンスを返す。
 * つまりキーが無くてもアプリは動き、カードは pending のまま作られる（§10-6）。
 */
import Anthropic from "@anthropic-ai/sdk";
import { buildFeedbackPrompt } from "@/lib/prompts/feedback";
import { RESPONSE_SCHEMA } from "@/lib/prompts/schema";
import type { FeedbackRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * adaptive thinking がデフォルトONで、max_tokens は thinking と本文の合算上限。
 * 途中で切れると検証層がエラー扱いにするので余裕を持たせる（§10-1）。
 */
const MAX_TOKENS = 8000;

/** クライアントは ok:false を受けたら pending 方式に落とす */
type RouteResult =
  | { ok: true; data: unknown }
  | { ok: false; reason: string };

const fallback = (reason: string) =>
  Response.json({ ok: false, reason } satisfies RouteResult, { status: 200 });

/** §10-7 の最小バリデート。外部から叩かれてもコストが爆発しないようにする */
function validateRequest(body: unknown): FeedbackRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.session !== "object" || b.session === null) return null;
  if (!Array.isArray(b.results) || !Array.isArray(b.pending)) return null;
  if (b.results.length < 1 || b.results.length > 40) return null;
  if (b.pending.length > 5) return null;
  return body as FeedbackRequest;
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fallback("リクエストが JSON として読めない");
  }

  const req = validateRequest(body);
  if (req === null) return fallback("リクエストの形式が不正");

  // ★キー未設定でも 500 にしない。pending 方式に落とす（§10-7）
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback("APIキーが未設定");

  const model = process.env.AI_MODEL ?? DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });

  try {
    const message = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      // temperature / top_p / top_k は渡さない（非デフォルト値は400エラー。§10-1）
      output_config: {
        format: { type: "json_schema", schema: RESPONSE_SCHEMA },
      },
      messages: [{ role: "user", content: buildFeedbackPrompt(req) }],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    if (text.trim() === "") return fallback("応答が空");

    // パースと検証はクライアント側の検証層（src/lib/aiResponse.ts）が行う。
    // ここでは素通しする（Route Handler にロジックを持たせない）。
    return Response.json({ ok: true, data: text } satisfies RouteResult);
  } catch (e) {
    const reason = e instanceof Error ? e.message : "AI呼び出しに失敗";
    return fallback(reason);
  }
}
