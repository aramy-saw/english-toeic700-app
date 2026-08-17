import { describe, expect, it } from "vitest";
import { buildFeedbackRequest } from "./feedbackRequest";
import { loadWordlist } from "./wordlist";
import type {
  AnsweredQuestion,
  CardMap,
  Cause,
  Choice,
  Question,
  ReviewCard,
  WordEntry,
} from "./types";

function entry(over: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 1,
    word: "available",
    wordKey: "available",
    posRaw: "形容詞",
    pos: "adj",
    posAll: ["adj"],
    meaning: "利用できる・空いている",
    meaningParts: ["利用できる", "空いている"],
    level: 1,
    exampleScene: "会議室の空き確認",
    similar: ["free", "open"],
    isCustom: false,
    ...over,
  };
}

function choice(over: Partial<Choice> = {}): Choice {
  return {
    choiceId: "c1",
    sourceId: 1,
    text: "利用できる・空いている",
    isCorrect: true,
    causeIfChosen: null,
    role: "correct",
    fallbackTier: 0,
    ...over,
  };
}

function question(e: WordEntry, choices: Choice[]): Question {
  return { entry: e, choices };
}

function answered(over: {
  entry?: WordEntry;
  choices?: Choice[];
  selectedChoiceId?: string | null;
  responseMs?: number | null;
  isCorrect?: boolean;
  isInstant?: boolean;
  cause?: Cause | null;
}): AnsweredQuestion {
  const e = over.entry ?? entry();
  const choices = over.choices ?? [choice()];
  return {
    question: question(e, choices),
    selectedChoiceId:
      over.selectedChoiceId === undefined ? "c1" : over.selectedChoiceId,
    responseMs: over.responseMs === undefined ? 3000 : over.responseMs,
    isCorrect: over.isCorrect ?? true,
    isInstant: over.isInstant ?? true,
    cause: over.cause ?? null,
  };
}

function card(over: Partial<ReviewCard> = {}): ReviewCard {
  return {
    id: 50,
    word: "overhead",
    meaning: "経費・間接費",
    level: 2,
    cause: "weak_memory",
    state: "pending",
    missCount: 1,
    hesitantCount: 0,
    createdAt: 100,
    updatedAt: 100,
    content: null,
    ...over,
  };
}

/** pending の similar / example_scene を引くための最小の配布データ */
function wordlistWith(ids: readonly number[]) {
  return loadWordlist(
    ids.map((id) => ({
      id,
      word: `word${id}`,
      pos: "名詞",
      meaning: `意味${id}`,
      level: 2,
      example_scene: `場面${id}`,
      similar: "alpha, beta",
    })),
  );
}

const BASE = {
  answers: [answered({})],
  tempo: "normal" as const,
  cards: {} as CardMap,
  wordlist: wordlistWith([50, 51, 52, 60, 61, 62, 63, 64, 65, 66, 67]),
};

describe("buildFeedbackRequest — session", () => {
  it("テンポ・閾値・ラベルを渡す（AIに閾値判定をさせない）", () => {
    const req = buildFeedbackRequest(BASE);

    expect(req.session.tempo).toBe("normal");
    expect(req.session.tempoLabel).toBe("ふつう");
    expect(req.session.instantThresholdMs).toBe(5000);
  });

  it("スコアと率は summarize と同じ値を渡す（AIに数えさせない）", () => {
    const req = buildFeedbackRequest({
      ...BASE,
      answers: [
        answered({ isCorrect: true, isInstant: true }),
        answered({ isCorrect: true, isInstant: false, cause: "hesitant" }),
        answered({ isCorrect: false, isInstant: false, cause: "weak_memory" }),
        answered({ isCorrect: false, isInstant: false, cause: "pos_mismatch" }),
      ],
    });

    expect(req.session.questionCount).toBe(4);
    expect(req.session.score).toBe(15); // 10 + 5 + 0 + 0
    expect(req.session.maxScore).toBe(40);
    expect(req.session.accuracyRate).toBeCloseTo(0.5);
    expect(req.session.instantRate).toBeCloseTo(0.25);
  });

  it("causeCounts を渡す。0件の原因も 0 として含める", () => {
    const req = buildFeedbackRequest({
      ...BASE,
      answers: [
        answered({ isCorrect: false, cause: "weak_memory" }),
        answered({ isCorrect: false, cause: "weak_memory" }),
      ],
    });

    expect(req.session.causeCounts).toEqual({
      pos_mismatch: 0,
      weak_memory: 2,
      hesitant: 0,
    });
  });
});

describe("buildFeedbackRequest — results", () => {
  it("出題語1件ごとに1件。posRaw を pos として渡す（正規化後の pos ではない）", () => {
    const req = buildFeedbackRequest({
      ...BASE,
      answers: [answered({ entry: entry({ posRaw: "名詞/動詞" }) })],
    });

    expect(req.results).toHaveLength(1);
    expect(req.results[0]?.pos).toBe("名詞/動詞");
  });

  it("選んだ肢の text を selected_meaning に渡す", () => {
    const choices = [
      choice({ choiceId: "a", text: "正解の意味", isCorrect: true }),
      choice({
        choiceId: "b",
        text: "選んだ誤答の意味",
        isCorrect: false,
        role: "A",
        causeIfChosen: "pos_mismatch",
      }),
    ];
    const req = buildFeedbackRequest({
      ...BASE,
      answers: [
        answered({
          choices,
          selectedChoiceId: "b",
          isCorrect: false,
          cause: "pos_mismatch",
        }),
      ],
    });

    expect(req.results[0]?.selected_meaning).toBe("選んだ誤答の意味");
  });

  it("無回答は selected_meaning が null（空文字にしない）", () => {
    const req = buildFeedbackRequest({
      ...BASE,
      answers: [
        answered({
          selectedChoiceId: null,
          responseMs: null,
          isCorrect: false,
          cause: "weak_memory",
        }),
      ],
    });

    expect(req.results[0]?.selected_meaning).toBeNull();
    expect(req.results[0]?.response_ms).toBeNull();
  });

  it("存在しない choiceId が入っていても落ちず null になる", () => {
    const req = buildFeedbackRequest({
      ...BASE,
      answers: [answered({ selectedChoiceId: "存在しない", isCorrect: false })],
    });

    expect(req.results[0]?.selected_meaning).toBeNull();
  });

  it("is_instant と cause はアプリ側の判定をそのまま渡す", () => {
    const req = buildFeedbackRequest({
      ...BASE,
      answers: [
        answered({ isCorrect: true, isInstant: false, cause: "hesitant" }),
      ],
    });

    expect(req.results[0]?.is_correct).toBe(true);
    expect(req.results[0]?.is_instant).toBe(false);
    expect(req.results[0]?.cause).toBe("hesitant");
  });
});

describe("buildFeedbackRequest — pending", () => {
  it("pending のカードだけを渡す（ready は渡さない）", () => {
    const cards: CardMap = {
      "50": card({ id: 50, state: "pending" }),
      "51": card({ id: 51, word: "mutual", state: "ready" }),
    };
    const req = buildFeedbackRequest({ ...BASE, cards });

    expect(req.pending.map((p) => p.id)).toEqual([50]);
  });

  it("★createdAt 昇順で渡す（selectCardTargets が配列順を信頼するため）", () => {
    const cards: CardMap = {
      "50": card({ id: 50, createdAt: 300 }),
      "51": card({ id: 51, createdAt: 100 }),
      "52": card({ id: 52, createdAt: 200 }),
    };
    const req = buildFeedbackRequest({ ...BASE, cards });

    expect(req.pending.map((p) => p.id)).toEqual([51, 52, 50]);
  });

  it("最大5件に絞る（route.ts の validateRequest が6件以上を弾く）", () => {
    const cards: CardMap = {};
    for (let i = 0; i < 8; i++) {
      cards[String(60 + i)] = card({ id: 60 + i, createdAt: i });
    }
    const req = buildFeedbackRequest({ ...BASE, cards });

    expect(req.pending).toHaveLength(5);
    expect(req.pending.map((p) => p.id)).toEqual([60, 61, 62, 63, 64]);
  });

  it("配布データに無い id のカードは落とす（similar / example_scene が引けない）", () => {
    const cards: CardMap = { "9999": card({ id: 9999, word: "unknown" }) };
    const req = buildFeedbackRequest({ ...BASE, cards });

    expect(req.pending).toHaveLength(0);
  });
});

describe("buildFeedbackRequest — 検証層に渡す文脈", () => {
  it("presentedIds は今回の出題 id と pending の id の和集合になる", () => {
    const cards: CardMap = { "50": card({ id: 50 }) };
    const req = buildFeedbackRequest({
      ...BASE,
      answers: [answered({ entry: entry({ id: 1 }) })],
      cards,
    });

    expect([...req.results.map((r) => r.id), ...req.pending.map((p) => p.id)]
      .sort((a, b) => a - b)).toEqual([1, 50]);
  });
});
