/**
 * ドック（docs/spec.md §13-7 a・§12-7）。
 * 主要な操作を親指の届く画面下端に置くための器。上辺に 1px の `--line`。
 *
 * ★position: fixed を使っていない。
 *   画面ルートを `min-h-[100dvh]` の縦 flex にし、読む領域を flex-1 にして、
 *   このドックを最後の子として置くことで下端に着く。fixed にすると
 *   iOS Safari のツールバー伸縮のたびに 100vh とズレて4択が隠れるため、
 *   その事故が起きない組み方にしてある。dvh は伸縮に追従する。
 *
 * ★padding に env(safe-area-inset-bottom) を足す。ホームバーに主ボタンが被らない。
 */
import type { ReactNode } from "react";

export function Dock({ children }: { children: ReactNode }) {
  return (
    <div
      className="border-t border-line bg-bg"
      style={{
        paddingBottom: "calc(var(--s4) + env(safe-area-inset-bottom))",
      }}
    >
      <div className="app-shell pt-[var(--s4)]">{children}</div>
    </div>
  );
}

/**
 * ドックの主ボタン（「はじめる」「次へ」「もう1セット」）。
 * 高さ 52px・幅100%（§13-7 a）。§13 のタップ領域下限 44px に対して余裕を持たせている。
 *
 * 押下のモーションは背景色 120ms のみ（§13-10 a）。拡大・影・波紋を付けない。
 */
export function DockButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[52px] w-full rounded-r2 border border-ok bg-ok-fill text-[17px] text-text transition-colors duration-[120ms] active:bg-ok active:text-bg"
    >
      {label}
    </button>
  );
}
