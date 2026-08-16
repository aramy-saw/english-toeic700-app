import { describe, expect, it } from "vitest";
import { CAUSE_LABEL, causeLabel, diagnose } from "@/lib/diagnosis";
import type { Choice, Question, WordEntry } from "@/lib/types";

/**
 * なぜテストすべきか：
 * cause はこのアプリの唯一の売り。ここが狂うと「原因が確定する」という主張が崩れる。
 * とくに 6・7 は、同じ回答時間でもテンポ設定で判定が変わることを固定する
 * （テンポが SCORE・卒業判定・AIの提案すべてに効くため）。
 */

const entry = (over: Partial<WordEntry> = {}): WordEntry => ({
  id: 1,
  word: "provide",
  wordKey: "provide",
  posRaw: "動詞",
  pos: "verb",
  posAll: ["verb"],
  meaning: "提供する・与える",
  meaningParts: ["提供する", "与える"],
  level: 1,
  exampleScene: "メール・報告",
  similar: ["supply", "offer", "give"],
  isCustom: false,
  ...over,
});

const choice = (over: Partial<Choice> & Pick<Choice, "choiceId">): Choice => ({
  sourceId: 999,
  text: "ダミーの意味",
  isCorrect: false,
  causeIfChosen: "weak_memory",
  role: "B",
  fallbackTier: 0,
  ...over,
});

/** 正解1（c0）／pos_mismatch（c1）／weak_memory（c2）の3択を持つ設問 */
const question = (): Question => ({
  entry: entry(),
  choices: [
    choice({
      choiceId: "c0",
      sourceId: 1,
      text: "提供する・与える",
      isCorrect: true,
      causeIfChosen: null,
      role: "correct",
    }),
    choice({ choiceId: "c1", causeIfChosen: "pos_mismatch", role: "A" }),
    choice({ choiceId: "c2", causeIfChosen: "weak_memory", role: "B" }),
  ],
});

describe("diagnose", () => {
  it("異なるposの選択肢を選ぶと pos_mismatch", () => {
    // なぜ：品詞の取り違え。課題②が名指ししている原因のひとつ
    const r = diagnose({
      question: question(),
      selectedChoiceId: "c1",
      responseMs: 2000,
      tempo: "normal",
    });
    expect(r.isCorrect).toBe(false);
    expect(r.cause).toBe("pos_mismatch");
  });

  it("同じposの選択肢を選ぶと weak_memory", () => {
    // なぜ：記憶が薄い。pos_mismatch と区別できることが診断の要
    const r = diagnose({
      question: question(),
      selectedChoiceId: "c2",
      responseMs: 2000,
      tempo: "normal",
    });
    expect(r.isCorrect).toBe(false);
    expect(r.cause).toBe("weak_memory");
  });

  it("無回答は weak_memory", () => {
    // なぜ：タイムアウト・「わからない」ボタン。選択肢を選んでいないので
    //       causeIfChosen から引けない経路
    const r = diagnose({
      question: question(),
      selectedChoiceId: null,
      responseMs: null,
      tempo: "normal",
    });
    expect(r.isCorrect).toBe(false);
    expect(r.cause).toBe("weak_memory");
  });

  it("正解・4秒・ふつう（閾値5秒）は即答なので cause は null", () => {
    // なぜ：復習対象外になる唯一の条件。ここが緩いとカードが増え続ける
    const r = diagnose({
      question: question(),
      selectedChoiceId: "c0",
      responseMs: 4000,
      tempo: "normal",
    });
    expect(r.isCorrect).toBe(true);
    expect(r.isInstant).toBe(true);
    expect(r.cause).toBeNull();
  });

  it("正解・6秒・ふつう（閾値5秒）は閾値超えで hesitant", () => {
    // なぜ：「正解しているのに迷った語」を拾う。既存アプリが見ていない領域
    const r = diagnose({
      question: question(),
      selectedChoiceId: "c0",
      responseMs: 6000,
      tempo: "normal",
    });
    expect(r.isCorrect).toBe(true);
    expect(r.isInstant).toBe(false);
    expect(r.cause).toBe("hesitant");
  });

  it("★正解・4秒でもテンポ「はやい」（閾値3秒）なら hesitant", () => {
    // なぜ：同じ回答時間でもテンポで判定が変わる。閾値がハードコードされていたら落ちる
    const r = diagnose({
      question: question(),
      selectedChoiceId: "c0",
      responseMs: 4000,
      tempo: "fast",
    });
    expect(r.isInstant).toBe(false);
    expect(r.cause).toBe("hesitant");
  });

  it("★正解・4秒でテンポ「ゆっくり」（閾値8秒）なら null", () => {
    // なぜ：上と対になる検証。テンポが両方向に効くことを固定する
    const r = diagnose({
      question: question(),
      selectedChoiceId: "c0",
      responseMs: 4000,
      tempo: "slow",
    });
    expect(r.isInstant).toBe(true);
    expect(r.cause).toBeNull();
  });
});

describe("causeLabel", () => {
  it("3つの Cause それぞれが固定文言を返す", () => {
    // なぜ：docs/spec.md §10-9。cause_label はレスポンススキーマから外してあり、
    //       アプリ側が cause から決定する。AIに生成させると呼び出しごとに
    //       文言が揺れて、同じ原因が別物に見える
    expect(causeLabel("pos_mismatch")).toBe("品詞の取り違え");
    expect(causeLabel("weak_memory")).toBe("意味の記憶があいまい");
    expect(causeLabel("hesitant")).toBe("思い出すのに時間がかかった");
    // 定数と関数がずれていないこと
    expect(causeLabel("pos_mismatch")).toBe(CAUSE_LABEL.pos_mismatch);
  });
});
