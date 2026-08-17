/**
 * 復習カードのライフサイクル（純関数）。
 *
 * カードキーは id（word ではない）。
 *   overhead(121「経費・間接費」) と overhead(287「頭上の・上空の」) は別カード。
 *
 * 卒業条件は「即答で正解」。正解しただけでは消さない。
 * 閾値の判定は diagnosis.ts が済ませており、ここは AnsweredQuestion.isInstant を読むだけ。
 *
 * localStorage への読み書きは src/platform/ の担当（STEP 6）。
 * ここは CardMap を受け取って新しい CardMap を返す純関数にする。
 */
import { idKey } from "./ids";
import type { AnsweredQuestion, CardMap, Cause, ReviewCard, WordId } from "./types";

/**
 * 1回のAI呼び出しで渡す pending の上限。
 * ★2026-08-18 に撤廃（docs/spec.md §10-10）。undefined で「全件」を意味する。
 *   定数は互換のために残さず、`selectPendingForCall(cards)` を引数なしで呼ぶ。
 */

function createCard(a: AnsweredQuestion, cause: Cause, now: number): ReviewCard {
  const e = a.question.entry;
  return {
    id: e.id,
    word: e.word,
    meaning: e.meaning,
    level: e.level,
    cause,
    state: "pending",
    missCount: cause === "hesitant" ? 0 : 1,
    hesitantCount: cause === "hesitant" ? 1 : 0,
    createdAt: now,
    updatedAt: now,
    content: null,
  };
}

function updateCard(prev: ReviewCard, cause: Cause, now: number): ReviewCard {
  const causeChanged = prev.cause !== cause;
  return {
    ...prev,
    cause,
    // ★cause が変わったら pending に戻すが、content は消さない（docs/spec.md §11）。
    //   古い説明を表示し続けたまま、次回のAI呼び出しで差し替える。
    //   「何も読めない状態」を作らないための仕様。
    state: causeChanged ? "pending" : prev.state,
    missCount: cause === "hesitant" ? prev.missCount : prev.missCount + 1,
    hesitantCount:
      cause === "hesitant" ? prev.hesitantCount + 1 : prev.hesitantCount,
    updatedAt: now,
  };
}

/**
 * 1セッション分の回答を、作成・更新・卒業までまとめて適用する。
 * 入力の CardMap は変更せず、新しい CardMap を返す。
 */
export function applySessionToCards(
  cards: CardMap,
  answers: readonly AnsweredQuestion[],
  now: number,
): CardMap {
  const out: CardMap = { ...cards };

  for (const a of answers) {
    const key = idKey(a.question.entry.id);
    const prev = out[key];

    // 卒業：即答で正解。正解しただけでは消さない
    if (a.isCorrect && a.isInstant) {
      if (prev !== undefined) delete out[key];
      continue;
    }

    // 復習対象は2種類：誤答した語／正解したが即答できなかった語
    if (a.cause === null) continue;

    out[key] =
      prev === undefined
        ? createCard(a, a.cause, now)
        : updateCard(prev, a.cause, now);
  }

  return out;
}

/**
 * カードを1枚消す（docs/spec.md §12-8・2026-08-18 追加）。
 *
 * ★消すのはカードだけ。 `wordStats` にも出題対象にも触らない。
 *   また間違えれば applySessionToCards がカードを作り直す。
 *   だから確認ダイアログを出さない（取り返しがつく操作）。
 *
 * ★キーは word ではなく id。 word 重複が26語あるため、
 *   overhead(121「経費」) を消すつもりで overhead(287「頭上の」) を消してはいけない。
 */
export function removeCard(cards: CardMap, id: WordId): CardMap {
  const out: CardMap = { ...cards };
  delete out[idKey(id)];
  return out;
}

/** createdAt 昇順（古い順）に最大 limit 件 */
export function selectPendingForCall(
  cards: CardMap,
  limit?: number,
): ReviewCard[] {
  const all = Object.values(cards)
    .filter((c) => c.state === "pending")
    .sort((a, b) => a.createdAt - b.createdAt);
  return limit === undefined ? all : all.slice(0, limit);
}
