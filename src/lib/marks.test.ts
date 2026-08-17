import { describe, expect, it } from "vitest";
import { restoreScoreMarks, toScoreMarks } from "./marks";
import type { AnsweredQuestion, Question, SessionRecord } from "./types";

/**
 * question の中身は目盛りに影響しない（isCorrect / isInstant だけを読む）ので、
 * ここでは最小のダミーを使う。出題語の組み立ては session.test.ts の担当。
 */
const DUMMY_QUESTION = { entry: {}, choices: [] } as unknown as Question;

function answered(isCorrect: boolean, isInstant: boolean): AnsweredQuestion {
  return {
    question: DUMMY_QUESTION,
    selectedChoiceId: isCorrect ? "c" : null,
    responseMs: 1000,
    isCorrect,
    isInstant,
    cause: null,
  };
}

const INSTANT = answered(true, true);
const HESITANT = answered(true, false);
const WRONG = answered(false, false);

describe("toScoreMarks", () => {
  it("正解かつ即答は instant（全高・10点）", () => {
    expect(toScoreMarks([INSTANT], 1)).toEqual(["instant"]);
  });

  it("正解だが即答でないものは correct（半分・5点）", () => {
    expect(toScoreMarks([HESITANT], 1)).toEqual(["correct"]);
  });

  it("誤答は wrong（下端・0点）", () => {
    expect(toScoreMarks([WRONG], 1)).toEqual(["wrong"]);
  });

  it("無回答も wrong に畳む（§13-8 の表で見え方が同じ）", () => {
    const noAnswer: AnsweredQuestion = {
      ...WRONG,
      selectedChoiceId: null,
      responseMs: null,
    };
    expect(toScoreMarks([noAnswer], 1)).toEqual(["wrong"]);
  });

  it("誤答なのに isInstant が true でも wrong（速く間違えたのは即答ではない）", () => {
    expect(toScoreMarks([answered(false, true)], 1)).toEqual(["wrong"]);
  });

  it("未到達の問題は unanswered で埋める（quiz 途中は枠だけが並ぶ）", () => {
    expect(toScoreMarks([INSTANT, WRONG], 5)).toEqual([
      "instant",
      "wrong",
      "unanswered",
      "unanswered",
      "unanswered",
    ]);
  });

  it("1問も答えていなければ全部 unanswered", () => {
    expect(toScoreMarks([], 3)).toEqual([
      "unanswered",
      "unanswered",
      "unanswered",
    ]);
  });

  it("必ず questionCount 本を返す（本数＝出題数。ScoreStrip はここを信じる）", () => {
    expect(toScoreMarks([], 10)).toHaveLength(10);
    expect(toScoreMarks([INSTANT, HESITANT, WRONG], 10)).toHaveLength(10);
  });

  it("answers が questionCount を超えても本数は questionCount に切り詰める", () => {
    // 起きてはいけない状態だが、起きたときに 11 本描いて図が崩れるより
    // 10 本で止まるほうが安全（本数＝出題数という読み方を壊さない）
    const over = [INSTANT, INSTANT, INSTANT];
    expect(toScoreMarks(over, 2)).toEqual(["instant", "instant"]);
  });

  it("§13-7 c の home の図（▇▇▅▇▇▁▅▇▇▇）と同じ並びを再現できる", () => {
    const answers = [
      INSTANT,
      INSTANT,
      HESITANT,
      INSTANT,
      INSTANT,
      WRONG,
      HESITANT,
      INSTANT,
      INSTANT,
      INSTANT,
    ];
    expect(toScoreMarks(answers, 10)).toEqual([
      "instant",
      "instant",
      "correct",
      "instant",
      "instant",
      "wrong",
      "correct",
      "instant",
      "instant",
      "instant",
    ]);
  });
});

function record(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    finishedAt: 1,
    dateLabel: "2026-08-17",
    tempo: "normal",
    score: 80,
    maxScore: 100,
    questionCount: 10,
    accuracyRate: 0.9,
    instantRate: 0.7,
    aiStatus: "pending",
    ...over,
  };
}

/**
 * ★home の目盛りは「本数だけ」の復元であり、位置＝問番号ではない
 *   （docs/spec.md §13-8。SessionRecord が1問ごとの結果を持たないため）。
 *   並びは 即答 → 迷い → 誤答 に固定する。
 */
describe("restoreScoreMarks", () => {
  it("正解率・即答率から本数を復元し、即答→迷い→誤答の順に並べる", () => {
    // 10問・正解率90%・即答率70% → 即答7 / 迷い2 / 誤答1
    expect(restoreScoreMarks(record())).toEqual([
      "instant",
      "instant",
      "instant",
      "instant",
      "instant",
      "instant",
      "instant",
      "correct",
      "correct",
      "wrong",
    ]);
  });

  it("必ず questionCount 本を返す", () => {
    expect(restoreScoreMarks(record({ questionCount: 10 }))).toHaveLength(10);
    expect(
      restoreScoreMarks(
        record({ questionCount: 7, accuracyRate: 1 / 3, instantRate: 1 / 7 }),
      ),
    ).toHaveLength(7);
  });

  it("満点は全部 instant", () => {
    const marks = restoreScoreMarks(
      record({ accuracyRate: 1, instantRate: 1, score: 100 }),
    );

    expect(new Set(marks)).toEqual(new Set(["instant"]));
  });

  it("全問誤答は全部 wrong", () => {
    const marks = restoreScoreMarks(
      record({ accuracyRate: 0, instantRate: 0, score: 0 }),
    );

    expect(new Set(marks)).toEqual(new Set(["wrong"]));
  });

  it("全問が迷い正解なら instant が 0 本になる", () => {
    const marks = restoreScoreMarks(
      record({ accuracyRate: 1, instantRate: 0, score: 50 }),
    );

    expect(marks.filter((m) => m === "correct")).toHaveLength(10);
    expect(marks.filter((m) => m === "instant")).toHaveLength(0);
  });

  it("端数が出ても本数の合計は questionCount に一致する", () => {
    // 3問・正解率 2/3・即答率 1/3
    const marks = restoreScoreMarks(
      record({ questionCount: 3, accuracyRate: 2 / 3, instantRate: 1 / 3 }),
    );

    expect(marks).toHaveLength(3);
    expect(marks.filter((m) => m === "unanswered")).toHaveLength(0);
  });

  it("questionCount が 0 なら空配列（記録が無い日）", () => {
    expect(restoreScoreMarks(record({ questionCount: 0 }))).toEqual([]);
  });

  it("★unanswered は返さない（過去のセッションに未回答は無い）", () => {
    const marks = restoreScoreMarks(record());

    expect(marks.includes("unanswered")).toBe(false);
  });
});
