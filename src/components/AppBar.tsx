/**
 * 上部バー（docs/spec.md §13-7 a）。
 *
 * 高さ 48px 固定・下辺に 1px の `--line`。**影を落とさない**（§13-5 b）。
 * 左は常に `ENGLISH700`（等幅）。右は画面ごとに変わるので slot にしてある。
 *
 * ★スクロールしても固定しない。 上は「読むもの」で、固定するのは下のドックだけ。
 *   両方固定すると 375×667 の実機で読める領域が 400px を切る。
 */
import type { ReactNode } from "react";

export function AppBar({ right }: { right?: ReactNode }) {
  return (
    <header className="border-b border-line">
      <div className="app-shell flex h-[48px] items-center justify-between">
        <span className="en text-[16px] tracking-[0.02em] text-text-sub">
          ENGLISH700
        </span>
        {right !== undefined && (
          <span className="text-[16px] text-text-sub">{right}</span>
        )}
      </div>
    </header>
  );
}
