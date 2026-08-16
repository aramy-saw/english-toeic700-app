/**
 * WordId → localStorage キー文字列の変換を1箇所に集約する最小モジュール。
 *
 * types.ts 以外からは何も import しない。
 * 理由：reviewCards.ts と session.ts が idKey ひとつのために wordlist.ts を
 * import すると、300語のJSONが依存グラフに付いてきて、純関数モジュールの
 * テストが単語データ全件を読むことになるため。
 *
 * キーが string なのは、localStorage が JSON であり JSON.parse 後のキーが
 * 必ず string になるという実行時の事実に型を合わせるため（docs/spec.md §9-2）。
 */
import type { WordId } from "./types";

export const idKey = (id: WordId): string => String(id);
