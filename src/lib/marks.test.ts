import { describe, expect, it } from "vitest";
import { toScoreMarks } from "./marks";
import type { AnsweredQuestion, Question } from "./types";

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
