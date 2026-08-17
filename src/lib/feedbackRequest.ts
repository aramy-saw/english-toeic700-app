/**
 * `FeedbackRequest` の組み立て（docs/spec.md §10-2）。
 *
 * ★何を AI に渡しているかを決める唯一の場所。
 *   CLAUDE.md の「テストする：プロンプト組み立て関数（＝何を渡しているか）」がここ。
 *   コンポーネントの中で組み立てない。テストできなくなる。
 *
 * ★数えるのも判定するのもアプリ側。
 *   causeCounts / is_instant / cause は算出済みの値を渡す。AI に数えさせない（§10-2）。
 */
import { MAX_PENDING_PER_CALL, selectPendingForCall } from "./reviewCards";
import { maxScore, summarize } from "./session";
import { TEMPO_THRESHOLD_MS, tempoLabel } from "./tempo";
import type {
  AnsweredQuestion,
  CardMap,
  FeedbackRequest,
  TempoId,
} from "./types";
import type { Wordlist } from "./wordlist";

/** 選んだ肢の表示文字列。無回答・不明な choiceId は null（空文字にしない） */
function selectedMeaning(a: AnsweredQuestion): string | null {
  if (a.selectedChoiceId === null) return null;
  const c = a.question.choices.find((x) => x.choiceId === a.selectedChoiceId);
  return c?.text ?? null;
}

export function buildFeedbackRequest(input: {
  answers: readonly AnsweredQuestion[];
  tempo: TempoId;
  cards: CardMap;
  /** pending カードの similar / example_scene を引くために要る */
  wordlist: Wordlist;
}): FeedbackRequest {
  const { answers, tempo, cards } = input;
  const s = summarize(answers);

  const session: FeedbackRequest["session"] = {
    tempo,
    tempoLabel: tempoLabel(tempo),
    instantThresholdMs: TEMPO_THRESHOLD_MS[tempo],
    questionCount: s.questionCount,
    score: s.score,
    maxScore: maxScore(s.questionCount),
    accuracyRate: s.accuracyRate,
    instantRate: s.instantRate,
    causeCounts: s.causeCounts,
  };

  const results: FeedbackRequest["results"] = answers.map((a) => {
    const e = a.question.entry;
    return {
      id: e.id,
      word: e.word,
      // ★正規化後の pos ではなく原文（posRaw）。AI には人間が読む表記を渡す（§10-2）
      pos: e.posRaw,
      level: e.level,
      meaning: e.meaning,
      similar: e.similar,
      example_scene: e.exampleScene,
      selected_meaning: selectedMeaning(a),
      is_correct: a.isCorrect,
      is_instant: a.isInstant,
      response_ms: a.responseMs,
      cause: a.cause,
    };
  });

  /**
   * ★createdAt 昇順で渡す。 selectCardTargets が配列順をそのまま信頼するため、
   *   ソートせずに渡すと §10-10 の優先順位が静かに壊れる。
   *   selectPendingForCall がソートと5件の絞り込みの両方を担う。
   */
  const pending: FeedbackRequest["pending"] = [];
  for (const c of selectPendingForCall(cards, MAX_PENDING_PER_CALL)) {
    const e = input.wordlist.byId.get(c.id);
    // 配布データに無い id は落とす。similar / example_scene が引けず、
    // 空で送ると AI が「類義語なし」を根拠に説明を書いてしまう
    if (e === undefined) continue;

    pending.push({
      id: c.id,
      word: e.word,
      pos: e.posRaw,
      level: e.level,
      meaning: e.meaning,
      similar: e.similar,
      example_scene: e.exampleScene,
      cause: c.cause,
    });
  }

  return { session, results, pending };
}
