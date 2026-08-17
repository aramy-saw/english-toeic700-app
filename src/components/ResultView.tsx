/**
 * 結果画面（docs/spec.md §12-6・§13-7 b・c）。
 *
 * ★`analyzing` と `result` でこのコンポーネントを分けない。
 *   同一レイアウトの状態差であり、変わるのは `ai` だけ（§12-6 a）。
 *   DOM を差し替えると「待たされた」という体験が生まれる。
 *
 * 上から SCORE → 目盛り → 率 → 原因の内訳 → **区切り線** → ここから下が AI（§13-7 b）。
 * この並びは AiSlot を最後に置くことで守られる。
 */
import { AiSlot, type AiState } from "@/components/AiSlot";
import { CauseTable } from "@/components/CauseTable";
import { Readout } from "@/components/Readout";
import type { AnsweredQuestion, SessionSummary, TempoId } from "@/lib/types";

export function ResultView({
  answers,
  summary,
  tempo,
  ai,
}: {
  answers: readonly AnsweredQuestion[];
  summary: SessionSummary;
  tempo: TempoId;
  ai: AiState;
}) {
  return (
    // ★塊の上限（--content-max-y）を付けない。
    //   結果画面は AI カードが到着すると縦に伸びる可変長の内容で、
    //   上限を付けると内側がスクロールして「読んでいる位置より下で増える」が壊れる。
    //   home / quiz と扱いが違うのは意図的（§13-7 b）。
    <div className="app-shell flex flex-col gap-[var(--s5)] py-[var(--s5)]">
      <Readout answers={answers} summary={summary} tempo={tempo} />
      <CauseTable summary={summary} />
      <AiSlot ai={ai} />
    </div>
  );
}
