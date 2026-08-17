/**
 * ★STEP 6 段階2 の確認用。段階3 で home / quiz / analyzing / result の
 *   状態機械（docs/spec.md §12-2）に全面的に差し替える。
 *
 * ScoreStrip の見え方を実機で確かめるためだけの画面なので、
 * ここで AppBar / Dock などの部品を先に作らない（§4 の担当は段階3）。
 *
 * Server Component のまま置く。new Date() もシャッフルも実行しない。
 */
import { ScoreStrip, type ScoreMark } from "@/components/ScoreStrip";

const I: ScoreMark = "instant";
const C: ScoreMark = "correct";
const W: ScoreMark = "wrong";
const U: ScoreMark = "unanswered";

const PATTERNS: ReadonlyArray<{
  title: string;
  note: string;
  marks: readonly ScoreMark[];
  showLegend: boolean;
}> = [
  {
    title: "全問即答正解",
    note: "100点。全高だけが並ぶ",
    marks: [I, I, I, I, I, I, I, I, I, I],
    showLegend: true,
  },
  {
    title: "混在",
    note: "docs/spec.md §13-7 c の図（▇▇▅▇▇▁▅▇▇▇）と同じ並び。80点",
    marks: [I, I, C, I, I, W, C, I, I, I],
    showLegend: true,
  },
  {
    title: "quiz 途中（3問回答済み）",
    note: "凡例を出さない。未回答は枠のみ",
    marks: [I, C, W, U, U, U, U, U, U, U],
    showLegend: false,
  },
];

export default function Home() {
  return (
    <main className="app-shell py-[var(--s5)]">
      <h1 className="en text-[16px] text-text-sub">ENGLISH700</h1>

      <div className="mt-[var(--s5)] flex flex-col gap-[var(--s6)]">
        {PATTERNS.map((p) => (
          <section key={p.title}>
            <h2 className="text-[16px] tracking-[0.04em] text-text-mute">
              {p.title}
            </h2>
            <div className="mt-[var(--s3)]">
              <ScoreStrip marks={p.marks} showLegend={p.showLegend} />
            </div>
            <p className="mt-[var(--s2)] text-[16px] text-text-mute">
              {p.note}
            </p>
          </section>
        ))}
      </div>
    </main>
  );
}
