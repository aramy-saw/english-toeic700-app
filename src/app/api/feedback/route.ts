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
import { buildMessageParams } from "@/lib/aiRequestParams";
import type { FeedbackRequest } from "@/lib/types";

export const runtime = "nodejs";
// ★2026-08-18 に 60 → 90。上限撤廃（§10-10）で1回の生成が長くなったため。
//   クライアント側の打ち切りは60秒なので、サーバーが先に落ちることはない
export const maxDuration = 90;

const DEFAULT_MODEL = "claude-sonnet-5";

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
  // pending の上限は撤廃（2026-08-18・§10-10）。暴走だけ防ぐ
  if (b.pending.length > 300) return null;
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

  /**
   * ★ストリーミングで素通しする（2026-08-18・§12-6 d）。
   *   モデルが書いた JSON の文字列を、届いた順にそのまま body へ流すだけ。
   *   パースも検証もしない（Route Handler にロジックを持たせない）。
   *
   * ★成功は text/plain、失敗は application/json。
   *   独自のプロトコルを作らず、Content-Type だけで区別する。
   *   ストリーム開始後に切れた場合は、body がそこで終わる。
   *   クライアントはそこまでに確定した分を保持する。
   */
  try {
    // ★パラメータの組み立ては lib 側（テスト可能にするため・§12-6 d）
    const stream = client.messages.stream(buildMessageParams(req, model));

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
        } catch {
          // 途中で切れてもエラーにしない。ここまでに流した分で成立させる
        } finally {
          controller.close();
        }
      },
      cancel() {
        stream.abort();
      },
    });

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        // 中間プロキシに溜め込ませない
        "cache-control": "no-store, no-transform",
      },
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : "AI呼び出しに失敗";
    return fallback(reason);
  }
}
