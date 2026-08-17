import { describe, expect, it } from "vitest";
import { FEEDBACK_TIMEOUT_MS } from "./feedbackClient";

/**
 * ★打ち切りの意味が変わった（2026-08-18・spec.md §12-6 f）。
 *   ストリーミング化で1枚ごとに保存されるため、打ち切りは
 *   「全部を失う境界」ではなく「そこで止める時刻」になった。
 *
 * ★値そのものを固定する。 実測に基づいて決めた数字なので、
 *   黙って変えられると根拠と実装がズレる。変えるときは spec.md も直す。
 */
describe("FEEDBACK_TIMEOUT_MS", () => {
  it("60秒（ローカル実測39.1秒に対する余裕）", () => {
    expect(FEEDBACK_TIMEOUT_MS).toBe(60000);
  });

  it("Route Handler の maxDuration より短い（サーバーが先に落ちない）", async () => {
    const route = await import("@/app/api/feedback/route");
    expect(FEEDBACK_TIMEOUT_MS).toBeLessThan(route.maxDuration * 1000);
  });
});
