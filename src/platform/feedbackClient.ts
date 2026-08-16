/**
 * クライアント → 自サーバー（/api/feedback）の fetch。
 *
 * src/platform/ の責務：fetch と AbortController を持つ。
 * 検証（V1〜V6）は src/lib/aiResponse.ts の純関数が行う。ここでは持たない。
 *
 * ★45秒で打ち切り、超えたら pending 方式に落ちる（docs/spec.md §10-7）。
 *   Route Handler 側の maxDuration は60秒なので、クライアントが必ず先に諦める。
 *
 *   45000 の根拠（docs/spec.md §12-6 f・§10-12 判断2）：
 *   結果画面は待機中もアプリ側計算をすべて描き、「もう1セット」で抜けられる。
 *   待機は強制ではないので45秒まで許容できる。本番実測の最大は28.88秒。
 *
 *   ★fetch 失敗（オフライン・圏外）も AbortError と同じく pending 方式に落とす。
 *     文言も区別しない（§12-7）。鈴木さんにとっては同じことなので。
 */
import type { FeedbackRequest } from "@/lib/types";

export const FEEDBACK_TIMEOUT_MS = 45000;

/**
 * ok:false は「AIの分析が取れなかった」という意味であり、エラーではない。
 * 呼び出し側はカードを pending のまま作り、1行だけ表示する（§10-6）。
 */
export type FeedbackFetchResult =
  | { ok: true; raw: unknown }
  | { ok: false; reason: string };

export async function fetchFeedback(
  req: FeedbackRequest,
  signal?: AbortSignal,
): Promise<FeedbackFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEEDBACK_TIMEOUT_MS);

  // 呼び出し側の signal（画面離脱など）と、こちらのタイムアウトの両方で中断できるようにする
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal,
    });

    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) {
      return { ok: false, reason: "応答が JSON オブジェクトではない" };
    }

    const b = body as Record<string, unknown>;
    if (b.ok === true) return { ok: true, raw: b.data };
    return {
      ok: false,
      reason: typeof b.reason === "string" ? b.reason : "AIの分析を取得できなかった",
    };
  } catch (e) {
    // タイムアウトも中断もここに来る。どちらも pending 方式に落とす
    const reason =
      e instanceof Error && e.name === "AbortError"
        ? "タイムアウト"
        : "通信に失敗";
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
