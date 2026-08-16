import { describe, expect, it } from "vitest";
import { shuffle } from "@/lib/shuffle";
import { createRng, rng } from "./rng";

/**
 * src/lib/ は Math.random を直接呼ばない（docs/spec.md §2）。
 * 乱数はここで作って引数で渡す。テストが決定論的になるのはこの設計のおかげ。
 */
describe("createRng", () => {
  it("注入した関数の戻り値をそのまま返す", () => {
    const fixed = createRng(() => 0.42);
    expect(fixed()).toBe(0.42);
    expect(fixed()).toBe(0.42);
  });

  it("注入した関数を呼び出しごとに1回だけ呼ぶ", () => {
    let calls = 0;
    const counted = createRng(() => {
      calls += 1;
      return 0;
    });

    counted();
    counted();
    counted();

    expect(calls).toBe(3);
  });

  it("src/lib/shuffle.ts に渡せる（Rng 型として使える）", () => {
    // rng が常に 0 を返すと Fisher-Yates は先頭と末尾を順に入れ替える。
    // 実装の結果ではなく「引数として通ること・決定論的であること」を見る。
    const zero = createRng(() => 0);
    const a = shuffle([1, 2, 3, 4], zero);
    const b = shuffle([1, 2, 3, 4], createRng(() => 0));

    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4]);
  });
});

describe("rng", () => {
  it("0以上1未満を返す", () => {
    for (let i = 0; i < 200; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
