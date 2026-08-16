import { describe, expect, it } from "vitest";
import { idKey } from "@/lib/ids";
import {
  applySessionToCards,
  MAX_PENDING_PER_CALL,
  selectPendingForCall,
} from "@/lib/reviewCards";
import type {
  AnsweredQuestion,
  CardMap,
  Question,
  ReviewCard,
  WordEntry,
} from "@/lib/types";

/**
 * なぜテストすべきか：
 * 復習カードは課題③「前進している実感」の担い手。卒業判定が緩いとカードが減らず、
 * 厳しすぎると覚えていない語が復習対象から消える。
 * とくに「id をキーにする」は、overhead(121「経費」) と overhead(287「頭上の」) を
 * 取り違えないための決定であり、word キーに戻されると静かに壊れる。
 */

const entry = (id: number, over: Partial<WordEntry> = {}): WordEntry => ({
  id,
  word: "overhead",
  wordKey: "overhead",
  posRaw: "名詞",
  pos: "noun",
  posAll: ["noun"],
  meaning: "経費・間接費",
  meaningParts: ["経費", "間接費"],
  level: 2,
  exampleScene: "会計",
  similar: [],
  isCustom: false,
  ...over,
});

const answered = (
  id: number,
  over: Partial<AnsweredQuestion> & Pick<AnsweredQuestion, "isCorrect" | "isInstant">,
  entryOver: Partial<WordEntry> = {},
): AnsweredQuestion => {
  const question: Question = { entry: entry(id, entryOver), choices: [] };
  return {
    question,
    selectedChoiceId: "c0",
    responseMs: 1000,
    cause: null,
    ...over,
  };
};

const card = (id: number, over: Partial<ReviewCard> = {}): ReviewCard => ({
  id,
  word: "overhead",
  meaning: "経費・間接費",
  level: 2,
  cause: "weak_memory",
  state: "pending",
  missCount: 1,
  hesitantCount: 0,
  createdAt: 1000,
  updatedAt: 1000,
  content: null,
  ...over,
});

describe("applySessionToCards", () => {
  it("即答で正解したらカードが削除される（卒業）", () => {
    // なぜ：卒業条件そのもの。カードが減ることが③の実感になる
    const cards: CardMap = { [idKey(121)]: card(121) };
    const out = applySessionToCards(
      cards,
      [answered(121, { isCorrect: true, isInstant: true })],
      2000,
    );
    expect(out[idKey(121)]).toBeUndefined();
  });

  it("正解しただけ（即答でない）では削除されない", () => {
    // なぜ：「迷わず出せて初めて卒業」。ここが緩いと覚えていない語が消える
    const cards: CardMap = { [idKey(121)]: card(121) };
    const out = applySessionToCards(
      cards,
      [answered(121, { isCorrect: true, isInstant: false, cause: "hesitant" })],
      2000,
    );
    expect(out[idKey(121)]).toBeDefined();
    expect(out[idKey(121)].hesitantCount).toBe(1);
  });

  it("★id が違えば別カードとして管理される（overhead の例）", () => {
    // なぜ：word をキーにすると overhead(121「経費」) を覚えただけで
    //       overhead(287「頭上の」) も卒業扱いになる。最も避けたい事故
    const out = applySessionToCards(
      {},
      [
        answered(121, { isCorrect: false, isInstant: false, cause: "weak_memory" }),
        answered(287, { isCorrect: false, isInstant: false, cause: "weak_memory" }, {
          meaning: "頭上の・上空の",
          meaningParts: ["頭上の", "上空の"],
        }),
      ],
      2000,
    );
    expect(Object.keys(out)).toHaveLength(2);
    expect(out[idKey(121)]).toBeDefined();
    expect(out[idKey(287)]).toBeDefined();
  });

  it("同じ id で2回目のカードが来たら上書きされる（重複しない）", () => {
    // なぜ：missCount が積み上がることが「何回も落としている語」の情報になる。
    //       作り直すと失われる
    const cards: CardMap = { [idKey(121)]: card(121, { missCount: 2 }) };
    const out = applySessionToCards(
      cards,
      [answered(121, { isCorrect: false, isInstant: false, cause: "weak_memory" })],
      2000,
    );
    expect(Object.keys(out)).toHaveLength(1);
    expect(out[idKey(121)].missCount).toBe(3);
    expect(out[idKey(121)].updatedAt).toBe(2000);
  });

  it("★cause が変化したカードは state が pending に戻るが、content は保持される", () => {
    // なぜ：この組み合わせ（state==="pending" かつ content!==null）は仕様上正当。
    //       docs/spec.md §11「cause が変わったら state を pending に戻す（content は残す）」。
    //       型では表現できないため、後から判別可能ユニオンに締められないよう
    //       テストで意図を残す。締めると「説明を読みながら次回の更新を待つ」状態が作れなくなる。
    const existing = card(121, {
      cause: "hesitant",
      state: "ready",
      content: {
        causeLabel: "自覚のない曖昧さ",
        explanation: "既存の説明",
        usageNote: "既存の使い分け",
        exampleEn: "existing",
        exampleJa: "既存",
        filledAt: 500,
      },
    });
    const out = applySessionToCards(
      { [idKey(121)]: existing },
      [answered(121, { isCorrect: false, isInstant: false, cause: "pos_mismatch" })],
      2000,
    );
    const updated = out[idKey(121)];
    expect(updated.cause).toBe("pos_mismatch");
    expect(updated.state).toBe("pending");
    expect(updated.content).not.toBeNull();
    expect(updated.content!.explanation).toBe("既存の説明");
  });
});

describe("selectPendingForCall", () => {
  it("pending を createdAt の古い順に最大5件まで返す", () => {
    // なぜ：プロンプトの肥大を防ぎつつ、数回で必ず追いつくための上限
    const cards: CardMap = {};
    for (let i = 1; i <= 8; i++) {
      cards[idKey(i)] = card(i, { createdAt: 1000 + i, state: "pending" });
    }
    cards[idKey(99)] = card(99, { createdAt: 1, state: "ready" });

    const picked = selectPendingForCall(cards);
    expect(picked).toHaveLength(MAX_PENDING_PER_CALL);
    expect(picked.map((c) => c.id)).toEqual([1, 2, 3, 4, 5]);
  });
});
