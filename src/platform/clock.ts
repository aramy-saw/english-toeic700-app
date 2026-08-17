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

/**
 * 壁時計。Date.now() のラッパ。createdAt / updatedAt / finishedAt に使う。
 *
 * ★経過時間の計測に使わない。 端末の時刻変更や NTP 補正で値が飛ぶ・巻き戻るため、
 *   2回の now() の差が負になったり数時間になったりしうる。経過時間は monotonicNow()。
 */
export function now(): number {
  return Date.now();
}

/**
 * 単調時計。performance.now() のラッパ。**経過時間の計測専用。**
 *
 * now() との違い：
 *   now()          … 「いつ」を表す絶対時刻。保存できる。時刻補正で飛ぶ
 *   monotonicNow() … 「どれだけ経ったか」を測るための相対値。単調増加が保証される
 *
 * ★用途は回答時間（responseMs）ただ1つ（docs/spec.md §7-1）。
 *   responseMs は得点 10/5/0 の土台なので、時刻補正で巻き戻ると
 *   即答判定が壊れる。ここで Date.now() の差分を取らない。
 *
 * ★返り値そのものを保存しない。 起点はページ読み込み時点であり壁時計ではないので、
 *   値単体には意味がない。意味があるのは2回の呼び出しの差だけ。
 */
export function monotonicNow(): number {
  return performance.now();
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
