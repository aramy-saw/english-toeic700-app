/**
 * 原因の内訳（docs/spec.md §12-6 b・§13-7 c）。**アプリ側の計算。**
 *
 * ★0件でも行を消さない。 理由は2つ。
 *   1. 原因が3種類あることを毎回見せる（このアプリの主張そのもの）
 *   2. 行数が変わると下にある AI 領域の位置が動く（§13-7 b が崩れる）
 *
 * ★このコンポーネントも AI 由来の値を prop に取らない（Readout と同じ理由）。
 */
import { CAUSE_LABEL } from "@/lib/diagnosis";
import type { Cause, SessionSummary } from "@/lib/types";

/** 表示順は固定。件数で並べ替えない（毎回同じ場所にある状態を保つ） */
const ORDER: readonly Cause[] = ["pos_mismatch", "weak_memory", "hesitant"];

export function CauseTable({ summary }: { summary: SessionSummary }) {
  return (
    <div>
      <h2 className="text-[16px] text-text-sub">原因の内訳</h2>
      <div className="mt-[var(--s2)] flex flex-col gap-[var(--s2)]">
        {ORDER.map((cause) => (
          <div key={cause} className="flex items-baseline justify-between">
            <span className="text-[17px]">{CAUSE_LABEL[cause]}</span>
            <span className="en text-[17px]">{summary.causeCounts[cause]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
