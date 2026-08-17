/**
 * SCORE と率（docs/spec.md §13-7 b・c）。**すべてアプリ側の計算。**
 *
 * ★このコンポーネントは AI 由来の値を prop に取らない。
 *   §13-7 b「AI 由来のものはアプリ側計算より下に置く」を、
 *   規約ではなく型で守るため。受け取れないので混ぜようがない。
 *
 * ★待機中も出し惜しみしない（§12-6 b）。 ここが埋まっているから
 *   28秒が「待ち時間」ではなく「読んでいる時間」になる。
 */
import { ScoreStrip } from "@/components/ScoreStrip";
import { toScoreMarks } from "@/lib/marks";
import { tempoLabel } from "@/lib/tempo";
import type { AnsweredQuestion, SessionSummary, TempoId } from "@/lib/types";

const pct = (rate: number): string => `${Math.round(rate * 100)}%`;

function Rate({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[16px] text-text-sub">{label}</span>
      <span className="en text-[17px]">{value}</span>
    </div>
  );
}

export function Readout({
  answers,
  summary,
  tempo,
}: {
  answers: readonly AnsweredQuestion[];
  summary: SessionSummary;
  tempo: TempoId;
}) {
  return (
    <div>
      {/*
       * SCORE。56px 等幅（§13-6 a）。
       * ★到着の動き（§13-10 a の4）。カウントアップはしない。
       *   値は最初から確定して出し、現れ方だけが動く。
       */}
      <p className="en score-arrive text-[56px] leading-[1.05]">
        {summary.score}
      </p>
      <p className="mt-[var(--s1)] text-[16px] text-text-sub">
        <span className="en">/ {summary.maxScore}</span>
        <span className="ml-[var(--s3)]">{tempoLabel(tempo)}</span>
      </p>

      {/*
       * SCORE の直下に目盛り。この合計が SCORE そのもの（§13-8）。
       * ★rise は result だけ true（§13-10 a の3）。値が確定した瞬間に立ち上がる。
       *   Readout は result 専用の部品なので、ここは常に true でよい。
       */}
      <div className="mt-[var(--s4)]">
        <ScoreStrip
          marks={toScoreMarks(answers, summary.questionCount)}
          showLegend
          rise
        />
      </div>

      <div className="mt-[var(--s5)] flex flex-col gap-[var(--s2)]">
        <Rate label="正解率" value={pct(summary.accuracyRate)} />
        <Rate label="即答率" value={pct(summary.instantRate)} />
      </div>
    </div>
  );
}
