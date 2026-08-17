/**
 * ScoreStrip — 署名要素（docs/spec.md §13-8）。
 *
 * 10問を10本の目盛りで表す。**色が正誤、高さが得点。**
 * 二層で読ませる。色で正誤、高さで精度（即答か迷いか）。
 * この目盛りの合計が SCORE そのものであり（§7-2 の 10/5/0 をそのまま高さにしている）、
 * 飾りではなく SCORE の内訳を1行で表した図である。だから SCORE の直下に置く。
 *
 * ★色は「復習対象かどうか」を表さない（§13-3 の例外）。
 *   正解(迷い)は緑だが復習カードにはなる。目盛りだけでは復習対象の総数は読めない。
 *
 * quiz の進捗（§12-2 の `3 / 10`）にも同じ部品を使う。**進捗バーを別に作らない。**
 *
 * ★ここでアニメーションを持たせない。動かすものは2つだけで（§13-10 a）、
 *   どちらもこの部品ではない。quiz で本が立つときも遷移を付けない。
 */

/** 1問の結果。誤答と無回答は同じ見え方（§13-8 の表）なので "wrong" に畳む */
export type ScoreMark = "instant" | "correct" | "wrong" | "unanswered";

/**
 * 目盛りの寸法（§13-8 の表）。
 * 20 / 10 / 3 は余白スケール（--s1〜--s8）ではなくこの部品固有の値なので、
 * トークンを増やさずここに閉じ込める。値を変えたくなったら先に spec.md を直す。
 *
 * 全マークを下端揃えにする（トラックは flex + items-end）。
 * 「誤答＝下端の残り3px」は共通ベースラインを前提にした書き方であり、
 * 揃えて初めて10本が1つの図として読める。
 */
const TRACK_HEIGHT = "h-[20px]";

const MARK_CLASS: Readonly<Record<ScoreMark, string>> = {
  // 即答正解 10点：全高
  instant: "h-[20px] bg-ok",
  // 正解（即答でない）5点：半分。正解なので --ok。迷いは高さが表す
  correct: "h-[10px] bg-ok",
  // 誤答・無回答 0点：下端の残り。★橙が立つのはここだけ
  wrong: "h-[3px] bg-attn",
  // 未回答（quiz 中）：枠のみ。面を持たない
  unanswered: "h-[20px] border border-line",
};

/** aria-label 用。画面には出さない（可視の状態表示は凡例が担う） */
const MARK_LABEL: Readonly<Record<ScoreMark, string>> = {
  instant: "即答正解",
  correct: "正解(迷い)",
  wrong: "誤答",
  unanswered: "未回答",
};

const MARK_ORDER: readonly ScoreMark[] = [
  "instant",
  "correct",
  "wrong",
  "unanswered",
];

/**
 * 凡例（§13-9）。**省略可能な補足ではなく必須の表示物。**
 * 色覚特性への配慮であると同時に、電車内で画面を斜めから見る状況への配慮でもある。
 *
 * [日本語部, 数値部, 区切り] に分けてあるのは2つの理由から：
 *   1. 数値だけを等幅にする（§13-6 a「英字だけを span で囲んで等幅にする」）
 *   2. 16px 下限（§13-6 b）を守ると内寸 320px には1行で入らないので折り返すが、
 *      日本語は既定でどこでも折れてしまう。1セグメントを nowrap で囲み、
 *      **区切りの後ろでだけ改行させる。** 区切りを前のセグメントに含めているのは
 *      「／」が行頭に落ちるのを防ぐため。
 */
const LEGEND_SEGMENTS: ReadonlyArray<{
  ja: string;
  num: string;
  tail: string;
}> = [
  { ja: "高＝即答正解", num: "10", tail: " ／" },
  { ja: "半＝正解(迷い)", num: "5", tail: " ／" },
  // ▁ は U+2581（全角アンダースコアではない）。docs/spec.md §13-7 c・§13-9 の表記
  { ja: "▁＝誤答", num: "0", tail: "" },
];

function describeMarks(marks: readonly ScoreMark[]): string {
  const parts = MARK_ORDER.map((mark) => {
    const count = marks.filter((m) => m === mark).length;
    return count === 0 ? null : `${MARK_LABEL[mark]} ${count}`;
  }).filter((p): p is string => p !== null);

  return `${marks.length}問の目盛り。${parts.join("、")}`;
}

type Props = {
  /**
   * 1問1本。本数は marks.length（★この部品に 10 を書かない）。
   * 呼び出し側が QUESTIONS_PER_SESSION の長さに揃えて渡す。
   */
  marks: readonly ScoreMark[];
  /**
   * 凡例を出すか。**既定値を置かず必ず明示させる。**
   * result / home では true、quiz では false（2026-08-17 確定）。
   * quiz の目盛りは §13-8 の言う「進捗」として働いており、回答後は選択肢の左に
   * 「正解 / 選択」の文字が出るので色だけに頼っていない。加えて 375×667 に
   * 凡例2〜3行を足すとドックが押し出され、§12-7「主要な操作と4択は下寄せ」が壊れる。
   */
  showLegend: boolean;
};

export function ScoreStrip({ marks, showLegend }: Props) {
  return (
    <div>
      {/* 10個の空要素が読み上げられるのを防ぐ。中身は1つの図として扱う */}
      <div
        role="img"
        aria-label={describeMarks(marks)}
        className={`flex items-end gap-[var(--s1)] ${TRACK_HEIGHT}`}
      >
        {marks.map((mark, i) => (
          <span
            // 目盛りは位置＝問番号であり並び替えないので index をキーにしてよい
            key={i}
            className={`min-w-0 flex-1 rounded-r1 ${MARK_CLASS[mark]}`}
          />
        ))}
      </div>

      {showLegend && (
        <p
          className="mt-[var(--s2)] text-[16px] leading-[1.6] tracking-[0.04em] text-text-sub"
          // 日本語ラベルの字間（§13-6 c）。数値側の -0.01em は .en が持つ
        >
          {LEGEND_SEGMENTS.map((seg, i) => (
            <span key={seg.ja}>
              {i > 0 && " "}
              <span className="inline-block whitespace-nowrap">
                {seg.ja}
                <span className="en">{seg.num}</span>
                {seg.tail}
              </span>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
