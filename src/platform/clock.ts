/**
 * 時刻。src/lib/ は Date.now() を直接呼ばず、ここから受け取る（docs/spec.md §2）。
 *
 * ★「今日」を作るのはこのファイルの todayJst() だけ（docs/spec.md §12-4）。
 *   用途は SessionRecord.dateLabel のみ。
 *
 * ★必ずクライアントから呼ぶ。Server Component から呼ばない。
 *   Vercel は UTC で動くため、サーバー側で「今日」を計算すると
 *   JST 0〜9時のあいだ日付が1日ずれる（CLAUDE.md「環境の罠」）。
 */

/** Date.now() のラッパ。createdAt / updatedAt / finishedAt に使う */
export function now(): number {
  return Date.now();
}

/**
 * JST の日付を "YYYY-MM-DD" で返す。
 *
 * ★`new Date().toISOString().slice(0,10)` は UTC になるので使わない（§12-4）。
 *   Intl に timeZone を渡して JST の暦日を出させる。
 *   ja-JP の既定表記は "2026/08/16" なので、formatToParts で組み直す。
 */
export function todayJst(ms: number = now()): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}
