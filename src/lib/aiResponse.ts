/**
 * AI応答の検証（docs/spec.md §10-5 の V1〜V6）と CardMap への反映。
 *
 * ★V2（検証）を先に行い、その後に slice(0,5) する（§10-5）。
 *   逆にすると、切り捨てられる範囲の不正な id が検出されず素通りする。
 */
import { causeLabel } from "./diagnosis";
import { idKey } from "./ids";
import type {
  AiReviewCard,
  CardMap,
  FeedbackResponse,
  TempoId,
  WordEntry,
  WordId,
} from "./types";

export type ValidationResult =
  | { ok: true; response: FeedbackResponse }
  | { ok: false; reason: string };

/** 検証に必要な文脈。V4（suggested_tempo）が現テンポと率を要求する（§10-4） */
export type ValidationContext = {
  /** 今回の出題 id ∪ pending の id */
  presentedIds: readonly WordId[];
  byId: ReadonlyMap<WordId, WordEntry>;
  currentTempo: TempoId;
  accuracyRate: number;
  instantRate: number;
};

/** V5 の文字列長上限（docs/spec.md §10-5）。末尾を切るだけ。「…」等は付けない */
const LIMITS = {
  explanation: 300,
  usage_note: 200,
  example_en: 200,
  example_ja: 150,
  pattern_summary: 200,
  next_message: 150,
} as const;

const clip = (s: string, max: number): string =>
  s.length <= max ? s : s.slice(0, max);

const isString = (v: unknown): v is string => typeof v === "string";
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const TEMPO_VALUES = ["slow", "normal", "fast", "none"] as const;
type SuggestedTempo = (typeof TEMPO_VALUES)[number];

/** V1: 1枚ぶんの形状検査 */
function parseCard(v: unknown): AiReviewCard | null {
  if (!isRecord(v)) return null;
  if (typeof v.id !== "number" || !Number.isInteger(v.id)) return null;
  for (const k of ["word", "explanation", "usage_note", "example_en", "example_ja"]) {
    if (!isString(v[k])) return null;
  }
  return {
    id: v.id,
    word: v.word as string,
    explanation: v.explanation as string,
    usage_note: v.usage_note as string,
    example_en: v.example_en as string,
    example_ja: v.example_ja as string,
  };
}

/**
 * §10-4 の発火条件をアプリ側で再計算する。
 * AIの提案を信用せず、条件を満たさなければ "none" に落とす。
 */
function verifySuggestedTempo(
  proposed: SuggestedTempo,
  ctx: ValidationContext,
): SuggestedTempo {
  if (proposed === "none") return "none";
  // 条件2: 現在のテンポと異なる値であること
  if (proposed === ctx.currentTempo) return "none";

  // 条件3: 数値条件をアプリが再計算して満たしていること
  if (proposed === "fast") {
    return ctx.instantRate >= 0.8 && ctx.accuracyRate >= 0.8 ? "fast" : "none";
  }
  if (proposed === "slow") {
    return ctx.accuracyRate <= 0.5 ? "slow" : "none";
  }
  // "normal" は「上記に当たらず現テンポが明らかに不適合」という定性条件。
  // アプリ側で再計算できる数値条件が無いので、現テンポと異なることだけを確認して通す。
  return "normal";
}

/**
 * ストリーミング中に**1枚だけ**を検証する（2026-08-18・§10-5 / §12-6 d）。
 *
 * ★全件そろう前に表示するので、全体を待つ V1 では間に合わない。
 *   形（V1 相当）・幻覚（V2）・文字数（V5）を1枚ずつ適用する。
 *   通らなければ **null を返して黙って捨てる**。表示しなければ害はない。
 *
 * ★最終的な正典は completion 時の validateAiResponse。
 *   こちらは表示を先行させるための前倒しであり、置き換えではない。
 */
export function validateStreamedCard(
  raw: unknown,
  ctx: ValidationContext,
): AiReviewCard | null {
  const card = parseCard(raw);
  if (card === null) return null;

  // V2: 出題していない id を弾く
  if (!ctx.presentedIds.includes(card.id)) return null;
  const entry = ctx.byId.get(card.id);
  if (entry !== undefined && entry.word !== card.word) return null;

  // V5: 文字列長の上限
  return {
    ...card,
    explanation: clip(card.explanation, LIMITS.explanation),
    usage_note: clip(card.usage_note, LIMITS.usage_note),
    example_en: clip(card.example_en, LIMITS.example_en),
    example_ja: clip(card.example_ja, LIMITS.example_ja),
  };
}

/** docs/spec.md §10-5 の V1〜V6 */
export function validateAiResponse(
  raw: unknown,
  ctx: ValidationContext,
): ValidationResult {
  // ── V1: パース／スキーマ形状の検査 ──
  let parsed: unknown = raw;
  if (isString(raw)) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "V1: JSON としてパースできない" };
    }
  }
  if (!isRecord(parsed)) return { ok: false, reason: "V1: オブジェクトではない" };

  if (!isString(parsed.pattern_summary)) {
    return { ok: false, reason: "V1: pattern_summary が文字列ではない" };
  }
  if (!isString(parsed.next_message)) {
    return { ok: false, reason: "V1: next_message が文字列ではない" };
  }
  if (!Array.isArray(parsed.review_cards)) {
    return { ok: false, reason: "V1: review_cards が配列ではない" };
  }
  if (
    !isString(parsed.suggested_tempo) ||
    !(TEMPO_VALUES as readonly string[]).includes(parsed.suggested_tempo)
  ) {
    return { ok: false, reason: "V1: suggested_tempo が不正な値" };
  }

  const cards: AiReviewCard[] = [];
  for (const item of parsed.review_cards) {
    const card = parseCard(item);
    if (card === null) {
      return { ok: false, reason: "V1: review_cards の要素の形状が不正" };
    }
    cards.push(card);
  }

  // ── V2: 幻覚の検査。★slice より先に行う（切り捨てる範囲も検査する） ──
  const presented = new Set<WordId>(ctx.presentedIds);
  for (const card of cards) {
    if (!presented.has(card.id)) {
      return { ok: false, reason: `V2: 出題していない id=${card.id} が返ってきた` };
    }
    const entry = ctx.byId.get(card.id);
    if (entry !== undefined && entry.word !== card.word) {
      return {
        ok: false,
        reason: `V2: id=${card.id} の word が不一致（期待 ${entry.word} / 実際 ${card.word}）`,
      };
    }
  }

  // V3: 復習対象がすべて含まれるかは検査しない（欠けた語は pending のまま残る）

  // ── V4: suggested_tempo を個別に検証。落ちても全体エラーにしない ──
  const suggested = verifySuggestedTempo(parsed.suggested_tempo as SuggestedTempo, ctx);

  // ── V5: 文字列長の上限クリップ ──
  const clipped = cards.map((c) => ({
    ...c,
    explanation: clip(c.explanation, LIMITS.explanation),
    usage_note: clip(c.usage_note, LIMITS.usage_note),
    example_en: clip(c.example_en, LIMITS.example_en),
    example_ja: clip(c.example_ja, LIMITS.example_ja),
  }));

  // ── V6: 撤廃（2026-08-18）。上限を設けず、届いた分をすべて通す（§10-10） ──
  return {
    ok: true,
    response: {
      pattern_summary: clip(parsed.pattern_summary, LIMITS.pattern_summary),
      review_cards: clipped,
      next_message: clip(parsed.next_message, LIMITS.next_message),
      suggested_tempo: suggested,
    },
  };
}

/**
 * 検証済みレスポンスを CardMap に反映する。cause_label はここで埋める。
 * ★cards に存在しない id は無視する（新規カードを作らない）。
 *   即答正解で卒業した語を復活させないため（§10-5）。
 */
export function applyAiResponseToCards(
  cards: CardMap,
  response: FeedbackResponse,
  now: number,
): CardMap {
  const out: CardMap = { ...cards };

  for (const card of response.review_cards) {
    const key = idKey(card.id);
    const existing = out[key];
    if (existing === undefined) continue; // 卒業済み・未作成の語は無視する

    out[key] = {
      ...existing,
      state: "ready",
      updatedAt: now,
      content: {
        // ★AIではなくアプリが cause から決める（§10-9）
        causeLabel: causeLabel(existing.cause),
        explanation: card.explanation,
        usageNote: card.usage_note,
        exampleEn: card.example_en,
        exampleJa: card.example_ja,
        filledAt: now,
      },
    };
  }

  return out;
}
