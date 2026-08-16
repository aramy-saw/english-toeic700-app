import { describe, expect, it } from "vitest";
import {
  allocateLevelSlots,
  buildSession,
  maxScore,
  POINTS,
  QUESTIONS_PER_SESSION,
  scoreAnswer,
  summarize,
} from "@/lib/session";
import { loadWordlist } from "@/lib/wordlist";
import { idKey } from "@/lib/ids";
import type {
  AnsweredQuestion,
  CardMap,
  Question,
  Rng,
  WordEntry,
  WordStatMap,
} from "@/lib/types";
import type { Wordlist } from "@/lib/wordlist";

/**
 * なぜテストすべきか：
 * 「問題数を定数1箇所で変えられる」は提出後のカスタム版（20問）のための設計。
 * 20問→2:8:10 を固定しておかないと、数字の 10 がどこかに直書きされても気づけない。
 */

const fixedRng = (): Rng => {
  let i = 0;
  return () => ((i++ * 13) % 100) / 100;
};

/** 線形合同法。seed 違いで異なる系列を作る */
const seeded = (seed: number): Rng => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
};

/**
 * 性質の違う rng を並べる。
 * ソート順を守る実装なら「どれを使っても同じ語が選ばれる」。
 * ソート後に全体をシャッフルする実装なら、いずれかで別の語が選ばれて落ちる。
 */
const everyRng = (): Rng[] => [
  () => 0, // 常に最小
  () => 0.9999, // 常にほぼ最大
  () => 0.5, // 常に中央
  fixedRng(),
  seeded(1),
  seeded(42),
  seeded(12345),
];

/** ★トップレベルで呼ばない（collection 時に落ちてテスト名が登録されなくなるため） */
const load = () => loadWordlist();

const stubEntry: WordEntry = {
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
};

const answered = (
  over: Partial<AnsweredQuestion> & Pick<AnsweredQuestion, "isCorrect" | "isInstant">,
): AnsweredQuestion => {
  const question: Question = { entry: stubEntry, choices: [] };
  return {
    question,
    selectedChoiceId: "c0",
    responseMs: 1000,
    cause: null,
    ...over,
  };
};

describe("allocateLevelSlots", () => {
  it("10問なら L1:L2:L3 = 1:4:5", () => {
    // なぜ：提出版の配分。配布データの 40:110:150 に近似させた比率
    expect(allocateLevelSlots(10)).toEqual({ 1: 1, 2: 4, 3: 5 });
  });

  it("★20問なら 2:8:10（定数1箇所の変更で成立する）", () => {
    // なぜ：比率として保持しているかの検証。枠数を直書きしていたら落ちる
    expect(allocateLevelSlots(20)).toEqual({ 1: 2, 2: 8, 3: 10 });
  });
});

describe("buildSession", () => {
  it("1セッション内で word が重複しない（word重複26語対策）", () => {
    // なぜ：同一セッションで overhead が2回出ると「さっき見た」記憶で解けてしまい
    //       cause が汚れる（§4 発見3）
    const questions = buildSession(
      { wordlist: load(), cards: {}, wordStats: {} },
      fixedRng(),
    );
    const keys = questions.map((q) => q.entry.wordKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("復習カードが0件なら全部が未学習から選ばれる", () => {
    // なぜ：初回起動の経路。分岐が実質発生しないことを確認する
    const questions = buildSession(
      { wordlist: load(), cards: {}, wordStats: {} },
      fixedRng(),
    );
    expect(questions).toHaveLength(QUESTIONS_PER_SESSION);
  });

  it("★復習カードがある語（tier0）が未学習語（tier1）より先に選ばれる", () => {
    // なぜ：docs/spec.md §5-3 のティア順そのもの。ここが逆転すると
    //       「間違えた語が次に出てくる」という学習ループが閉じない。
    //       出題順は S6 でシャッフルされるため、順序ではなく「選ばれた集合」を検証する。
    const wl = load();
    const l3 = wl.byLevel.get(3)!;

    // L3枠は5件。wordKey が重複しない L3 の語をちょうど5つ選んで復習カードを付ける
    const seen = new Set<string>();
    const targets = l3.filter((e) => !seen.has(e.wordKey) && seen.add(e.wordKey)).slice(0, 5);
    expect(targets).toHaveLength(5);

    const cards: CardMap = {};
    for (const e of targets) {
      cards[idKey(e.id)] = {
        id: e.id,
        word: e.word,
        meaning: e.meaning,
        level: e.level,
        cause: "weak_memory",
        state: "pending",
        missCount: 1,
        hesitantCount: 0,
        createdAt: 1,
        updatedAt: 1,
        content: null,
      };
    }

    const questions = buildSession({ wordlist: wl, cards, wordStats: {} }, fixedRng());
    const pickedL3 = questions.filter((q) => q.entry.level === 3).map((q) => q.entry.id);
    const targetIds = new Set(targets.map((e) => e.id));

    // L3の5枠はすべて復習カードの語で埋まるはず（未学習語より優先されるため）
    expect(pickedL3).toHaveLength(5);
    for (const id of pickedL3) {
      expect(targetIds.has(id), `id=${id} は復習カードの語ではない`).toBe(true);
    }
  });

  it("★未学習語（tier1）が既出語（tier2）より先に選ばれる", () => {
    // なぜ：docs/spec.md §5-3。既出語を先に出すと、300語を一周する体験が遠のく。
    //       L1は枠1件・40語なので、39語を既出にすれば残り1語が必ず選ばれるはず
    const wl = load();
    const l1 = wl.byLevel.get(1)!;
    expect(l1.length).toBeGreaterThan(1);

    const unlearned = l1[0];
    const wordStats: WordStatMap = {};
    for (const e of l1.slice(1)) {
      wordStats[idKey(e.id)] = {
        seenCount: 1,
        correctCount: 1,
        instantCorrectCount: 1,
        lastSeenAt: 1000,
      };
    }

    const questions = buildSession({ wordlist: wl, cards: {}, wordStats }, fixedRng());
    const pickedL1 = questions.filter((q) => q.entry.level === 1);

    expect(pickedL1).toHaveLength(1);
    expect(pickedL1[0].entry.id).toBe(unlearned.id);
  });

  it("★level枠が埋まらないとき、補充パスが他のレベルで埋める（S4）", () => {
    // なぜ：docs/spec.md §5-4 S4。枠が埋まらないまま返すと出題数が減り、
    //       満点・進捗表示がセッションごとにブレる。
    //       L1の候補を空にして deficit を作り、それでも規定数が返ることを確認する。
    const wl = load();
    const noL1: Wordlist = {
      entries: wl.entries, // 誤答生成用のプールは全件のまま
      byId: wl.byId,
      byLevel: new Map(
        [...wl.byLevel].map(([lv, es]) => [lv, lv === 1 ? [] : es]),
      ),
    };

    const questions = buildSession({ wordlist: noL1, cards: {}, wordStats: {} }, fixedRng());

    expect(questions).toHaveLength(QUESTIONS_PER_SESSION);
    expect(questions.filter((q) => q.entry.level === 1)).toHaveLength(0);
  });

  it("★tier2：lastSeenAt が最も古い語が、どの rng でも必ず選ばれる", () => {
    // なぜ：docs/spec.md §5-3「lastSeenAt 昇順 → 同値の中だけシャッフル」。
    //       シャッフルがソート結果全体に掛かる実装（＝仕様の (A) 解釈）だと、
    //       「久しく見ていない語を優先」が壊れ、tier分けが機能しなくなる。
    //       ★rng を複数試すのがこのテストの要点。1つ固定では (A) の実装でも
    //         たまたま通ってしまい、順序が守られている証明にならない。
    const wl = load();
    const l1 = wl.byLevel.get(1)!;

    // L1全40語を既出（tier2）にし、lastSeenAt をすべて異なる値にする
    const wordStats: WordStatMap = {};
    l1.forEach((e, i) => {
      wordStats[idKey(e.id)] = {
        seenCount: 1,
        correctCount: 1,
        instantCorrectCount: 0,
        lastSeenAt: 1000 + i, // i=0 が最も古い
      };
    });
    const oldest = l1[0];

    for (const rng of everyRng()) {
      const questions = buildSession({ wordlist: wl, cards: {}, wordStats }, rng);
      const pickedL1 = questions.filter((q) => q.entry.level === 1);
      expect(pickedL1).toHaveLength(1);
      expect(pickedL1[0].entry.id).toBe(oldest.id);
    }
  });

  it("★tier0：missCount が最も多いカードが、どの rng でも必ず選ばれる", () => {
    // なぜ：docs/spec.md §5-3「missCount 降順 → updatedAt 昇順 → 同値の中だけシャッフル」。
    //       「何度も落としている語を優先」が壊れると、苦手な語がいつまでも卒業できない。
    //       ★こちらも rng を複数試す（理由は上と同じ）。
    const wl = load();
    const l1 = wl.byLevel.get(1)!;

    // L1の先頭5語に、それぞれ異なる missCount のカードを付ける
    const targets = l1.slice(0, 5);
    const cards: CardMap = {};
    targets.forEach((e, i) => {
      cards[idKey(e.id)] = {
        id: e.id,
        word: e.word,
        meaning: e.meaning,
        level: e.level,
        cause: "weak_memory",
        state: "pending",
        missCount: i + 1, // 最後の要素が最大
        hesitantCount: 0,
        createdAt: 1000,
        updatedAt: 1000,
        content: null,
      };
    });
    const mostMissed = targets[targets.length - 1];

    for (const rng of everyRng()) {
      const questions = buildSession({ wordlist: wl, cards, wordStats: {} }, rng);
      const pickedL1 = questions.filter((q) => q.entry.level === 1);
      expect(pickedL1).toHaveLength(1);
      expect(pickedL1[0].entry.id).toBe(mostMissed.id);
    }
  });
});

describe("SCORE", () => {
  it("配点は 即答正解10点 / 迷った正解5点 / 誤答0点", () => {
    // なぜ：得点の基本。天井が生まれない設計の土台
    expect(scoreAnswer(answered({ isCorrect: true, isInstant: true }))).toBe(
      POINTS.instantCorrect,
    );
    expect(scoreAnswer(answered({ isCorrect: true, isInstant: false }))).toBe(
      POINTS.slowCorrect,
    );
    expect(scoreAnswer(answered({ isCorrect: false, isInstant: false }))).toBe(
      POINTS.wrong,
    );
  });

  it("10問すべて即答正解なら満点（100点）", () => {
    // なぜ：満点が問題数から算出されているかの確認
    const answers = Array.from({ length: QUESTIONS_PER_SESSION }, () =>
      answered({ isCorrect: true, isInstant: true }),
    );
    const s = summarize(answers);
    expect(s.score).toBe(maxScore(QUESTIONS_PER_SESSION));
    expect(s.score).toBe(100);
  });

  it("10問すべて誤答なら0点", () => {
    // なぜ：下限の確認
    const answers = Array.from({ length: QUESTIONS_PER_SESSION }, () =>
      answered({ isCorrect: false, isInstant: false }),
    );
    expect(summarize(answers).score).toBe(0);
  });

  it("全問正解でも全部迷えば50点（天井が生まれない）", () => {
    // なぜ：SCOREの設計意図そのもの。正解率が満点でもまだ半分の伸びしろがある
    const answers = Array.from({ length: QUESTIONS_PER_SESSION }, () =>
      answered({ isCorrect: true, isInstant: false }),
    );
    expect(summarize(answers).score).toBe(50);
  });

  it("正解率と即答率が算出される（結果画面の内訳表示用）", () => {
    // なぜ：SCOREの内訳＝診断。大きい数字の下に出す2つの小さい数字
    const answers = [
      ...Array.from({ length: 9 }, () => answered({ isCorrect: true, isInstant: false })),
      answered({ isCorrect: false, isInstant: false }),
    ];
    const s = summarize(answers);
    expect(s.accuracyRate).toBeCloseTo(0.9);
    expect(s.instantRate).toBeCloseTo(0);
  });
});
