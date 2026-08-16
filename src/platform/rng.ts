/**
 * 乱数。src/lib/ は Math.random() を直接呼ばず、Rng を引数で受け取る（docs/spec.md §2）。
 * ここが Math.random を呼ぶ唯一の場所。
 *
 * ★実行タイミングは UI 層の責任（docs/spec.md §12-3）。
 *   出題の組み立て（＝シャッフル）は「はじめる」のイベントハンドラ内で行う。
 *   useEffect で回すと React 19 の StrictMode が開発時に2回実行し、
 *   1回目の出題が捨てられて表示とログがズレる。
 */
import type { Rng } from "@/lib/types";

/**
 * 乱数源を差し替え可能にして返す。
 * テストは固定値を注入し、本番は既定の Math.random を使う。
 */
export function createRng(source: () => number = Math.random): Rng {
  return () => source();
}

/** アプリが使う既定の乱数。0以上1未満 */
export const rng: Rng = createRng();
