/**
 * RNG を引数で受け取る純粋シャッフル。
 * src/lib/ は Math.random を直接呼ばない（テストを決定論的にするため）。
 * 実行タイミング（クライアント側・マウント後）は UI 層の責任（docs/spec.md §12-3）。
 */
import type { Rng } from "./types";

/** rng() が 1 を返しても添字が範囲外にならないようにする */
const indexOf = (rng: Rng, size: number): number =>
  Math.min(size - 1, Math.floor(rng() * size));

/** Fisher-Yates。入力は変更せず、新しい配列を返す */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = indexOf(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pickOne<T>(items: readonly T[], rng: Rng): T | null {
  if (items.length === 0) return null;
  return items[indexOf(rng, items.length)];
}
