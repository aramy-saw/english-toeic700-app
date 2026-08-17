/**
 * AI 由来のものを置ける**唯一の場所**（docs/spec.md §13-7 b・§12-6）。
 *
 * ★区切り線から下がこのコンポーネント。 Readout / CauseTable は
 *   AI の値を prop に取れないので、AI 由来のものがここより上に出ることは
 *   構造的に起きない。28秒後にカードが届いても、読んでいる位置より下でしか変化しない。
 *
 * ★レイアウトを状態で切り替えない（§12-6 a）。
 *   `analyzing` と `result` は同一レイアウトの状態差であり、画面遷移ではない。
 *   枠は常に同じで、中身だけが「分析中…」→ 本文に変わる。
 *
 * ★pattern_summary の枠は2行分を予約する。 1行→2行で下が動くため。
 *   review_cards は最下部なので予約しない。
 */
import { ReviewCardView } from "@/components/ReviewCard";
import type { FeedbackResponse, ReviewCard } from "@/lib/types";

export type AiState =
  | { status: "waiting" }
  | { status: "ready"; response: FeedbackResponse; cards: ReviewCard[] }
  | { status: "failed" };

/** pattern_summary の 2行分（17px × line-height 1.75 × 2行） */
const SUMMARY_MIN_H = "min-h-[60px]";

/**
 * 1枚ずつ 0.1 秒間隔でフェードイン（§12-6 e）。240ms / ease-out。
 * prefers-reduced-motion: reduce のときは遅延も移動も不透明度の遷移も無くす（§13-10）。
 */
function cardStyle(index: number): React.CSSProperties {
  return { animationDelay: `${index * 100}ms` };
}

export function AiSlot({ ai }: { ai: AiState }) {
  return (
    <section className="border-t border-line pt-[var(--s5)]">
      {/* 枠は常にここにある。中身だけが差し替わる */}
      <div className={SUMMARY_MIN_H}>
        {ai.status === "waiting" && (
          // ★スピナーを置かない（§12-6 e）。視線を奪わない
          <p className="text-[17px] text-text-mute">分析中…</p>
        )}
        {ai.status === "failed" && (
          // ★1行のみ。謝らない・再取得ボタンを置かない（§10-6）
          <p className="text-[17px] text-text-mute">
            今日の分析は取得できませんでした
          </p>
        )}
        {ai.status === "ready" && (
          <p className="text-[17px]">{ai.response.pattern_summary}</p>
        )}
      </div>

      {/* ★0枚のときは何も出さない。「復習カードはありません」も出さない（§12-6 e） */}
      {ai.status === "ready" && ai.cards.length > 0 && (
        <div className="mt-[var(--s5)] flex flex-col gap-[var(--s3)]">
          {ai.cards.map((card, i) => (
            <div key={card.id} className="card-arrive" style={cardStyle(i)}>
              <ReviewCardView card={card} />
            </div>
          ))}
        </div>
      )}

      {ai.status === "ready" && (
        <p className="mt-[var(--s5)] text-[17px] text-text-sub">
          {ai.response.next_message}
        </p>
      )}
    </section>
  );
}
