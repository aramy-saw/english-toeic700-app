import { describe, expect, it } from "vitest";
import { shuffle } from "@/lib/shuffle";
import type { Rng } from "@/lib/types";

/**
 * なぜテストすべきか：
 * shuffle は distractors.ts（選択肢の並び）と session.ts（出題順）の両方が依存する土台。
 * ここが決定論的でないと、他の34件すべてが再現しないテストになる。
 */

/** 0, 0.1, 0.2, ... を順に返す決定論的な擬似乱数 */
const seq = (): Rng => {
  let i = 0;
  return () => ((i++ * 7) % 10) / 10;
};

describe("shuffle", () => {
  it("同じ rng を渡せば同じ順序になる（決定論性）", () => {
    // なぜ：テストが毎回同じ結果になる前提。Math.random を内部で呼んでいたらここで落ちる
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = shuffle(items, seq());
    const b = shuffle(items, seq());
    expect(a).toEqual(b);
  });

  it("要素が欠落も重複もしない", () => {
    // なぜ：並べ替えであって、取りこぼしや複製が起きてはいけない。
    //       誤答生成でこれが崩れると選択肢が消えるか二重になる
    const items = ["a", "b", "c", "d", "e"];
    const out = shuffle(items, seq());
    expect(out).toHaveLength(items.length);
    expect([...out].sort()).toEqual([...items].sort());
  });
});
