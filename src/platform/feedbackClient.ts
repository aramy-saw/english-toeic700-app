/**
 * クライアント → 自サーバー（/api/feedback）の fetch。
 *
 * src/platform/ の責務：fetch と AbortController を持つ。
 * 検証（V1〜V6）は src/lib/aiResponse.ts の純関数が行う。ここでは持たない。
 *
 * ★90秒で打ち切る（2026-08-18 変更。docs/spec.md §12-6 f）。
 *   Route Handler 側の maxDuration は120秒なので、クライアントが必ず先に諦める。
 *
 *   ★打ち切りの意味が変わった。 ストリーミング化（§12-6 d）により、
 *   ここまでに届いたカードは**すでに localStorage に書かれている**。
 *   打ち切りは「全部を失う」ではなく「そこで打ち切って、届いた分で成立させる」。
 *
 *   90000 の根拠：上限撤廃（§10-10）で1回の対象が15件になりうる。
 *   ローカル実測で15件・60.4秒（thinking 既定）。余裕を持たせて90秒とした。
 *
 *   ★fetch 失敗（オフライン・圏外）も AbortError と同じく pending 方式に落とす。
 *     文言も区別しない（§12-7）。鈴木さんにとっては同じことなので。
 */
import type { FeedbackRequest } from "@/lib/types";

export const FEEDBACK_TIMEOUT_MS = 90000;

/**
 * ok:false は「AIの分析が取れなかった」という意味であり、エラーではない。
 * 呼び出し側はカードを pending のまま作り、1行だけ表示する（§10-6）。
 */
export type FeedbackFetchResult =
  | { ok: true; raw: unknown }
  | { ok: false; reason: string };

/**
 * ★2026-08-18 ストリーミング対応（§12-6 d）。
 *   `onProgress` には「ここまでに届いた文字列の全体」を渡す。差分ではない。
 *   呼び出し側は `extractPartial` で確定した分だけを取り出す。
 *
 * ★途中で切れても失敗にしない。 そこまでに届いた文字列を ok:true で返す。
 *   1文字も届かなかったときだけ ok:false にする。
 */
export async function fetchFeedback(
  req: FeedbackRequest,
  signal?: AbortSignal,
  onProgress?: (snapshot: string) => void,
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

    // 失敗は application/json の {ok:false}。成功は text/plain のストリーム（§10-7）
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
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
    }

    if (res.body === null) return { ok: false, reason: "応答の本文が無い" };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let snapshot = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        snapshot += decoder.decode(value, { stream: true });
        onProgress?.(snapshot);
      }
    } catch {
      // 途中で切れた。ここまでの snapshot で成立させる
    }

    if (snapshot.trim() === "") return { ok: false, reason: "応答が空" };
    return { ok: true, raw: snapshot };
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
