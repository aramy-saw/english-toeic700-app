import { describe, expect, it } from "vitest";
import { now, todayJst } from "./clock";

/**
 * ★todayJst は UTC ではなく JST で日付を返す（docs/spec.md §12-4）。
 *   `new Date().toISOString().slice(0,10)` は UTC になるので使わない。
 *   Vercel は UTC で動くため、ここを間違えると JST 0〜9時に日付が1日ずれる。
 */
describe("todayJst", () => {
  it("JST の日付を YYYY-MM-DD で返す", () => {
    // 2026-08-16 12:00 JST（= 03:00 UTC）
    const ms = Date.UTC(2026, 7, 16, 3, 0, 0);
    expect(todayJst(ms)).toBe("2026-08-16");
  });

  it("UTC の深夜（15:00Z）は JST では翌日になる", () => {
    // 2026-08-16 15:00 UTC = 2026-08-17 00:00 JST
    const ms = Date.UTC(2026, 7, 16, 15, 0, 0);
    expect(todayJst(ms)).toBe("2026-08-17");
  });

  it("JST の日付が変わる1秒前はまだ当日", () => {
    // 2026-08-16 14:59:59 UTC = 2026-08-16 23:59:59 JST
    const ms = Date.UTC(2026, 7, 16, 14, 59, 59);
    expect(todayJst(ms)).toBe("2026-08-16");
  });

  it("月・日が1桁でもゼロ埋めする", () => {
    // 2026-01-05 09:00 JST（= 00:00 UTC）
    const ms = Date.UTC(2026, 0, 5, 0, 0, 0);
    expect(todayJst(ms)).toBe("2026-01-05");
  });

  it("年をまたぐ境界でも JST で判定する", () => {
    // 2025-12-31 15:00 UTC = 2026-01-01 00:00 JST
    const ms = Date.UTC(2025, 11, 31, 15, 0, 0);
    expect(todayJst(ms)).toBe("2026-01-01");
  });

  it("引数を省略すると現在時刻で YYYY-MM-DD 形式を返す", () => {
    expect(todayJst()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("now", () => {
  it("現在時刻のミリ秒を返す", () => {
    const before = Date.now();
    const value = now();
    const after = Date.now();

    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(after);
  });
});
