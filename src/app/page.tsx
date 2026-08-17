/**
 * `/`（docs/spec.md §12-1）。
 *
 * ★薄い Server Component のまま保つ。`<QuizRoot />` を返すだけ。
 *   "use client" をここに付けない。付けると `/` 全体がクライアント境界になり、
 *   §12-2 の boot（SSR と同一の静的スケルトン）が作れなくなる。
 *
 * ★new Date() もシャッフルも書かない。
 *   Vercel は UTC なのでサーバー側の「今日」は1日ずれ、
 *   サーバー側の乱数はハイドレーション不一致になる（CLAUDE.md「環境の罠」）。
 */
import { QuizRoot } from "@/components/QuizRoot";

export default function Page() {
  return <QuizRoot />;
}
