/**
 * 4択の1つ（docs/spec.md §13-7 a・c）。高さ 56px・角丸 `--r2`・間隔 8px は呼び出し側。
 *
 * ★回答後は色だけでなく**文字**で状態を出す（§13-9 の対応表）。
 *   正解の肢に `正解`、自分が選んだ誤答に `選択`。左に 2px の縦線も添える。
 *
 * ★文字ラベルの枠は回答前から確保しておく。
 *   回答した瞬間にラベルが現れて意味テキストが右へずれると、
 *   「どれを押したか」を目で追っている最中に行が動く。空でも場所を取らせる。
 *
 * ★押下のモーションは背景色 120ms のみ（§13-10 a）。拡大も影も付けない。
 */
/** 回答後の見え方。ScoreMark とは別物（あちらは目盛り、こちらは選択肢） */
export type ChoiceState = "idle" | "correct" | "chosenWrong" | "other";

const BOX_CLASS: Readonly<Record<ChoiceState, string>> = {
  idle: "border-line bg-surface text-text",
  correct: "border-ok bg-ok-fill text-text",
  chosenWrong: "border-attn bg-attn-fill text-text",
  // 選ばなかった不正解。読めるが主張しない
  other: "border-line bg-surface text-text-mute",
};

const RULE_CLASS: Readonly<Record<ChoiceState, string>> = {
  idle: "bg-transparent",
  correct: "bg-ok",
  chosenWrong: "bg-attn",
  other: "bg-transparent",
};

const LABEL: Readonly<Record<ChoiceState, string>> = {
  idle: "",
  correct: "正解",
  chosenWrong: "選択",
  other: "",
};

const LABEL_COLOR: Readonly<Record<ChoiceState, string>> = {
  idle: "",
  correct: "text-ok",
  chosenWrong: "text-attn",
  other: "",
};

export function ChoiceButton({
  text,
  state,
  onClick,
}: {
  text: string;
  state: ChoiceState;
  /** 回答後は渡さない。押せない状態にする */
  onClick?: () => void;
}) {
  const answered = onClick === undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={answered}
      className={`flex min-h-[56px] w-full items-center gap-[var(--s2)] rounded-r2 border pr-[var(--s3)] text-left transition-colors duration-[120ms] disabled:opacity-100 ${BOX_CLASS[state]} ${answered ? "" : "active:bg-ok-fill"}`}
    >
      {/* 左の縦線 2px（§13-9「形」の列）。回答前は透明のまま場所だけ取る */}
      <span
        aria-hidden
        className={`h-[56px] w-[2px] shrink-0 ${RULE_CLASS[state]}`}
      />
      {/* 文字ラベルの枠。回答前も幅を確保して行送りを固定する */}
      <span
        className={`w-[2.5rem] shrink-0 text-[16px] leading-[1.3] ${LABEL_COLOR[state]}`}
      >
        {LABEL[state]}
      </span>
      {/* 意味は長いものがあるので2行まで折り返す。行間を詰めて 56px に収める */}
      <span className="min-w-0 flex-1 py-[var(--s2)] text-[17px] leading-[1.4]">
        {text}
      </span>
    </button>
  );
}

/**
 * 回答結果から各肢の状態を決める。
 * ★無回答（selectedChoiceId === null）のときは `選択` をどこにも出さない。
 *   「わからない」は誤答ではあるが、選んでいないものを選んだことにしない。
 */
export function choiceStateOf(input: {
  isCorrectChoice: boolean;
  isSelected: boolean;
  revealed: boolean;
}): ChoiceState {
  if (!input.revealed) return "idle";
  if (input.isCorrectChoice) return "correct";
  return input.isSelected ? "chosenWrong" : "other";
}
