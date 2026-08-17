"use client";

/**
 * `/` の状態機械（docs/spec.md §12-2）。
 *
 * ★page.tsx ではなくここが "use client" を持つ（§12-1）。
 *   page.tsx に付けると `/` 全体がクライアント境界になり、
 *   boot（SSR と同一の静的スケルトン）が作れなくなる。
 *
 * ★`analyzing` を独立した phase として持たない（§12-2・2026-08-17 確定）。
 *   `ai.status === "waiting"` が analyzing、`"ready"` / `"failed"` が result。
 *   同じ事実を2箇所に持つと必ずズレる。
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";

import type { AiState } from "@/components/AiSlot";
import { AppBar } from "@/components/AppBar";
import { ChoiceButton, choiceStateOf } from "@/components/ChoiceButton";
import { Dock, DockButton } from "@/components/Dock";
import { ResultView } from "@/components/ResultView";
import { ScoreStrip } from "@/components/ScoreStrip";
import { validateAiResponse, applyAiResponseToCards } from "@/lib/aiResponse";
import { diagnose } from "@/lib/diagnosis";
import { buildFeedbackRequest } from "@/lib/feedbackRequest";
import { restoreScoreMarks, toScoreMarks } from "@/lib/marks";
import { applySessionToCards } from "@/lib/reviewCards";
import { buildSession, summarize } from "@/lib/session";
import { buildSessionRecord, markSessionAiReady } from "@/lib/sessionRecord";
import { isNoAnswer, tempoLabel } from "@/lib/tempo";
import type {
  AnsweredQuestion,
  CardMap,
  FeedbackRequest,
  Question,
  SessionRecord,
  TempoId,
} from "@/lib/types";
import { applySessionToWordStats } from "@/lib/wordStats";
import { loadWordlist } from "@/lib/wordlist";
import { monotonicNow, now, todayJst } from "@/platform/clock";
import { fetchFeedback } from "@/platform/feedbackClient";
import {
  getPersistedSnapshot,
  getServerPersistedSnapshot,
  isBootSnapshot,
  subscribePersisted,
  writePersisted,
} from "@/platform/persisted";
import { rng } from "@/platform/rng";

/**
 * 配布300語の正規化はモジュール評価時に1回だけ。
 * 静的バンドルなので通信は起きない（§12-7「出題自体はオフラインでも動く」）。
 */
const WORDLIST = loadWordlist();

const TEMPOS: readonly TempoId[] = ["slow", "normal", "fast"];

type Phase = "home" | "quiz" | "result";

export function QuizRoot() {
  const persisted = useSyncExternalStore(
    subscribePersisted,
    getPersistedSnapshot,
    getServerPersistedSnapshot,
  );

  const [phase, setPhase] = useState<Phase>("home");

  // §12-5「捨てる（React state）」。もう1セットでここだけ初期化する
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<AnsweredQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [ai, setAi] = useState<AiState>({ status: "waiting" });

  /** そのセッション中に固定するテンポ。途中で設定が変わっても採点がぶれない */
  const [sessionTempo, setSessionTempo] = useState<TempoId>(
    persisted.settings.tempo,
  );

  /** セッションの通し番号。AI 呼び出しの二重送信ガードに使う */
  const [sessionSeq, setSessionSeq] = useState(0);
  const sentSeq = useRef<number | null>(null);

  /**
   * AI に送るリクエスト。**セッション確定の時点で作って固める。**
   *
   * ★cards を書き込む前に作るのが要点（§10-2・§10-10）。
   *   applySessionToCards の後に作ると、今回できたばかりのカードまで
   *   `pending`＝「前回までに説明を作れなかった語」として渡ることになり、
   *   AI に渡す区分が実態とズレる。
   */
  const pendingRequest = useRef<FeedbackRequest | null>(null);

  /**
   * 出題を表示した時刻（monotonicNow）。
   * ★描画に使わない値なので state ではなく ref。
   */
  const questionStartedAt = useRef<number | null>(null);

  /** ★シャッフルはイベントハンドラ内（§12-3）。StrictMode の二重実行を避ける */
  function startSession() {
    const built = buildSession(
      {
        wordlist: WORDLIST,
        cards: persisted.cards,
        wordStats: persisted.wordStats,
      },
      rng,
    );

    setQuestions(built);
    setAnswers([]);
    setCurrentIndex(0);
    setAi({ status: "waiting" });
    setSessionTempo(persisted.settings.tempo);
    questionStartedAt.current = monotonicNow();
    setPhase("quiz");
  }

  /**
   * 回答の確定。選択肢タップと「わからない」の両方がここに来る。
   * choiceId === null が「わからない」。
   *
   * ★経過時間が NO_ANSWER_TIMEOUT_MS を超えていたら無回答に倒す（§7-1）。
   *   タイマーで自動的に進めることはしない。
   */
  function answer(choiceId: string | null) {
    const question = questions[currentIndex];
    if (question === undefined) return;
    if (answers.length > currentIndex) return; // 二重回答の防止

    const startedAt = questionStartedAt.current;
    const elapsed =
      startedAt === null ? null : Math.round(monotonicNow() - startedAt);

    // 起点が無い（測れない）ときも無回答に倒す。推測値を responseMs に入れない
    const timedOut = elapsed === null || isNoAnswer(elapsed);
    const selectedChoiceId = timedOut ? null : choiceId;
    const responseMs = selectedChoiceId === null ? null : elapsed;

    const result = diagnose({
      question,
      selectedChoiceId,
      responseMs,
      tempo: sessionTempo,
    });

    setAnswers((prev) => [
      ...prev,
      { question, selectedChoiceId, responseMs, ...result },
    ]);
  }

  /**
   * セッションの確定書き込み（§12-2 の quiz→analyzing）。
   * ★AI を待たない。 28秒のあいだにアプリを閉じても記録は残る。
   */
  function finishSession(finalAnswers: readonly AnsweredQuestion[]) {
    const at = now();

    // ★書き込みより先に組み立てる（pendingRequest のコメント参照）
    pendingRequest.current = buildFeedbackRequest({
      answers: finalAnswers,
      tempo: sessionTempo,
      cards: persisted.cards,
      wordlist: WORDLIST,
    });

    const record = buildSessionRecord({
      answers: finalAnswers,
      tempo: sessionTempo,
      finishedAt: at,
      dateLabel: todayJst(at), // ★クライアントで JST 算出（§12-4）
    });

    writePersisted({
      cards: applySessionToCards(persisted.cards, finalAnswers, at),
      wordStats: applySessionToWordStats(
        persisted.wordStats,
        finalAnswers,
        at,
      ),
      // 新しい順。writeSessions が 50件に切り詰める
      sessions: [record, ...persisted.sessions],
    });
  }

  function goNext() {
    if (currentIndex + 1 >= questions.length) {
      finishSession(answers);
      setSessionSeq((n) => n + 1);
      setPhase("result");
      return;
    }
    setCurrentIndex((i) => i + 1);
    questionStartedAt.current = monotonicNow();
  }

  /** 中断。★何も保存しない（§12-2） */
  const quitToHome = useCallback(() => {
    setQuestions([]);
    setAnswers([]);
    setCurrentIndex(0);
    setAi({ status: "waiting" });
    questionStartedAt.current = null;
    setPhase("home");
  }, []);

  /**
   * AI 呼び出し（§12-3 が useEffect を明示的に許可している唯一の箇所）。
   *
   * ★sentSeq で二重送信を防ぐ。 StrictMode の2回実行対策であり、
   *   そのまま API コストの対策でもある。
   *
   * ★クリーンアップで abort する。 「もう1セット」やホームへ戻る操作で
   *   応答は破棄する（§12-6 c・2026-08-17 確定）。裏で生かさない。
   */
  useEffect(() => {
    if (phase !== "result" || sessionSeq === 0) return;
    if (sentSeq.current === sessionSeq) return;
    sentSeq.current = sessionSeq;

    const ac = new AbortController();
    void requestFeedback(ac.signal);
    return () => ac.abort();

    async function requestFeedback(signal: AbortSignal) {
      const req = pendingRequest.current;
      if (req === null) {
        setAi({ status: "failed" });
        return;
      }

      const res = await fetchFeedback(req, signal);
      if (signal.aborted) return;

      // ★失敗の理由を画面で出し分けない（§12-7）。ログにだけ残す
      if (!res.ok) {
        console.warn("[feedback] 取得できず:", res.reason);
        setAi({ status: "failed" });
        return;
      }

      const validated = validateAiResponse(res.raw, {
        presentedIds: [
          ...req.results.map((r) => r.id),
          ...req.pending.map((p) => p.id),
        ],
        byId: WORDLIST.byId,
        currentTempo: sessionTempo,
        accuracyRate: req.session.accuracyRate,
        instantRate: req.session.instantRate,
      });

      if (signal.aborted) return;

      // ★検証落ちも「取れなかった」と同じ扱い。カードは pending のまま残る
      if (!validated.ok) {
        console.warn("[feedback] 検証に失敗:", validated.reason);
        setAi({ status: "failed" });
        return;
      }

      const at = now();
      const latest = getPersistedSnapshot();
      const nextCards = applyAiResponseToCards(
        latest.cards,
        validated.response,
        at,
      );

      writePersisted({
        cards: nextCards,
        sessions: markSessionAiReady(latest.sessions),
      });

      setAi({
        status: "ready",
        response: validated.response,
        cards: pickArrivedCards(nextCards, validated.response.review_cards),
      });
    }
    // answers / persisted は sessionSeq が変わる瞬間の値で確定しているので依存に入れない。
    // 入れるとカード書き込みで persisted が変わるたびに再送してしまう。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, sessionSeq]);

  if (isBootSnapshot(persisted)) return <BootSkeleton />;

  if (phase === "home") {
    return (
      <HomeView
        lastSession={persisted.sessions[0]}
        pendingCount={countReviewCards(persisted.cards)}
        tempo={persisted.settings.tempo}
        onChangeTempo={(t) => writePersisted({ settings: { tempo: t } })}
        onStart={startSession}
      />
    );
  }

  if (phase === "result") {
    return (
      <Shell
        right="結果"
        dock={
          <div className="flex flex-col gap-[var(--s2)]">
            <DockButton label="もう1セット" onClick={startSession} />
          </div>
        }
        below={
          <button
            type="button"
            onClick={quitToHome}
            className="min-h-[44px] w-full text-[16px] text-text-mute"
          >
            ホームへ
          </button>
        }
      >
        <ResultView
          answers={answers}
          summary={summarize(answers)}
          tempo={sessionTempo}
          ai={ai}
        />
      </Shell>
    );
  }

  return (
    <QuizView
      questions={questions}
      answers={answers}
      currentIndex={currentIndex}
      onAnswer={answer}
      onNext={goNext}
      onQuit={quitToHome}
    />
  );
}

/** AI が説明を付けたカードだけを、応答の順序で取り出す */
function pickArrivedCards(
  cards: CardMap,
  arrived: readonly { id: number }[],
): CardMap[string][] {
  return arrived
    .map((a) => cards[String(a.id)])
    .filter((c): c is CardMap[string] => c !== undefined);
}

/** 復習カードの枚数。卒業した語は cards から消えているので全件が対象 */
function countReviewCards(cards: CardMap): number {
  return Object.keys(cards).length;
}

/**
 * 画面の器（§13-7 a）。上＝読むもの／下＝触るもの。
 *
 * ★ドックを position: fixed にしない。100dvh の縦 flex で下端に着ける。
 *   fixed は iOS Safari のツールバー伸縮で 100vh とズレ、4択が隠れる。
 */
function Shell({
  right,
  children,
  dock,
  below,
}: {
  right?: ReactNode;
  children: ReactNode;
  dock: ReactNode;
  /** ドックの主ボタンの下に置く控えめな操作（「ホームへ」など） */
  below?: ReactNode;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppBar right={right} />
      {/*
       * ★縦 flex にしてあるのは、中身の塊が `my-auto` で垂直中央に置けるようにするため。
       *   余った高さはこの main が持ち、塊の外側（上下）へ均等に出る。
       */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </main>
      <Dock below={below}>{dock}</Dock>
    </div>
  );
}

/**
 * boot（§12-2）。**localStorage 由来の値を一切描かない。**
 * SSR の出力とこれが一致するので、ハイドレーション不一致が起きない。
 */
function BootSkeleton() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppBar />
      <main className="min-h-0 flex-1" />
    </div>
  );
}

/** ホーム（§13-7 c） */
function HomeView({
  lastSession,
  pendingCount,
  tempo,
  onChangeTempo,
  onStart,
}: {
  lastSession: SessionRecord | undefined;
  pendingCount: number;
  tempo: TempoId;
  onChangeTempo: (t: TempoId) => void;
  onStart: () => void;
}) {
  return (
    <Shell dock={<DockButton label="はじめる" onClick={onStart} />}>
      {/*
       * ★quiz と同じ塊の作り（§13-5 c・§13-7 a）。
       *   上限 --content-max-y まで伸ばし、超えた余りは塊の外へ均等に出して中央に置く。
       *   これが無いと PC の縦長ウィンドウで内容が上に固まり、下2/3が空白になる
       *   （2026-08-17 実機で修正）。
       */}
      <div className="app-shell my-auto flex w-full max-h-[var(--content-max-y)] shrink-0 grow flex-col justify-between gap-[var(--s5)] py-[var(--s5)]">
        <p className="text-[26px] leading-[1.5]">なぜ間違えたかが、わかる。</p>

        {/* ★初回は「前回」を出さない。0点の枠を見せない（§13-1 必要なことだけ出す） */}
        {lastSession !== undefined && (
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-[16px] text-text-sub">前回</span>
              <span className="text-[17px]">
                <span className="en">{lastSession.score}点</span>
                <span className="ml-[var(--s2)] text-text-sub">
                  {tempoLabel(lastSession.tempo)}
                </span>
              </span>
            </div>
            <div className="mt-[var(--s3)]">
              {/*
               * ★本数だけの復元であり、位置＝問番号ではない（§13-8）。
               *   凡例は出す。何を見ているか分からない図にしない
               */}
              {/* ★rise=false。過去の記録であって、いま測ったものではない（§13-10 a） */}
              <ScoreStrip
                marks={restoreScoreMarks(lastSession)}
                showLegend
                rise={false}
              />
            </div>
            <div className="mt-[var(--s4)] flex justify-between text-[16px]">
              <span className="text-text-sub">
                正解率{" "}
                <span className="en text-text">
                  {Math.round(lastSession.accuracyRate * 100)}%
                </span>
              </span>
              <span className="text-text-sub">
                即答率{" "}
                <span className="en text-text">
                  {Math.round(lastSession.instantRate * 100)}%
                </span>
              </span>
            </div>
          </div>
        )}

        <Link
          href="/review"
          className="flex min-h-[44px] items-center justify-between border-t border-line pt-[var(--s4)] text-[17px]"
        >
          <span>復習カード</span>
          <span>
            <span className="en">{pendingCount}枚</span>
            <span className="ml-[var(--s2)] text-text-sub">→</span>
          </span>
        </Link>

        <div className="border-t border-line pt-[var(--s4)]">
          <div className="flex items-center gap-[var(--s2)]">
            <span className="text-[16px] text-text-sub">テンポ</span>
            {TEMPOS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onChangeTempo(t)}
                className={`min-h-[44px] flex-1 rounded-r2 border px-[var(--s2)] text-[16px] ${
                  t === tempo
                    ? "border-ok text-text"
                    : "border-line text-text-sub"
                }`}
              >
                {tempoLabel(t)}
              </button>
            ))}
          </div>
          {/* ★色だけで現在値を示さない。文字でも出す（§13-9） */}
          <p className="mt-[var(--s2)] text-[16px] text-text-sub">
            現在：{tempoLabel(tempo)}
          </p>
        </div>
      </div>
    </Shell>
  );
}

function QuizView({
  questions,
  answers,
  currentIndex,
  onAnswer,
  onNext,
  onQuit,
}: {
  questions: readonly Question[];
  answers: readonly AnsweredQuestion[];
  currentIndex: number;
  onAnswer: (choiceId: string | null) => void;
  onNext: () => void;
  onQuit: () => void;
}) {
  const question = questions[currentIndex];
  if (question === undefined) return null;

  /**
   * ★「回答済みか」を state に持たない。answers の長さから導く。
   *   進捗・目盛り・選択肢の正誤表示の3箇所が必ず同じ真実を見る。
   */
  const revealed = answers.length > currentIndex;
  const selectedChoiceId = revealed
    ? (answers[currentIndex]?.selectedChoiceId ?? null)
    : null;

  return (
    <Shell
      right={
        <span className="en">
          {currentIndex + 1} / {questions.length}
        </span>
      }
      dock={
        revealed ? (
          <DockButton label="次へ" onClick={onNext} />
        ) : (
          // 「わからない」は誤答を作るのではなく無回答を作る（§7-1）
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => onAnswer(null)}
              className="min-h-[44px] px-[var(--s2)] text-[17px] text-text-sub"
            >
              わからない
            </button>
            <button
              type="button"
              onClick={onQuit}
              className="min-h-[44px] px-[var(--s2)] text-[17px] text-text-mute"
            >
              やめる
            </button>
          </div>
        )
      }
    >
      {/*
       * 読む領域の中身は1つの塊にまとめ、**高さに上限を与えて垂直中央に置く**。
       * 横を --content-max（480px）で止めたのと同じことを縦にもする。
       *
       *   grow      … 空きがあれば --content-max-y まで伸びる
       *   max-h     … そこで止める。これ以上は内部の間隔を広げない
       *   my-auto   … 上限に達したあとの余りを上下へ均等に出し、塊を中央に置く
       *   shrink-0  … 画面が足りないときは縮めずに main 側をスクロールさせる
       *   justify-between … 上限までの空きを目盛り／出題語／4択のあいだで分け合う
       *   gap       … 分け合う前の最低間隔（32px）
       */}
      <div className="app-shell my-auto flex w-full max-h-[var(--content-max-y)] shrink-0 grow flex-col justify-between gap-[var(--s6)] py-[var(--s5)]">
        {/*
         * 進捗バーを別に作らない。得点と同じ部品を使う（§13-8）。
         * ★rise=false。 これは進捗であって計測結果ではない（§13-10 a）。
         *   1問答えるたびに立ち上がると、答えるより目盛りを見る時間が増える。
         */}
        <ScoreStrip
          marks={toScoreMarks(answers, questions.length)}
          showLegend={false}
          rise={false}
        />

        {/* 出題語（§13-7 a「上は読むもの」） */}
        <div>
          <p className="en text-[clamp(26px,8vw,34px)] leading-[1.3]">
            {question.entry.word}
          </p>
          <p className="mt-[var(--s2)] text-[16px] text-text-sub">
            {question.entry.posRaw}
          </p>
        </div>

        {/* 4択（§13-7 a・§12-7）。肢の間隔 8px */}
        <div className="flex flex-col gap-[var(--s2)]">
          {question.choices.map((c) => (
            <ChoiceButton
              key={c.choiceId}
              text={c.text}
              state={choiceStateOf({
                isCorrectChoice: c.isCorrect,
                isSelected: c.choiceId === selectedChoiceId,
                revealed,
              })}
              onClick={revealed ? undefined : () => onAnswer(c.choiceId)}
            />
          ))}
        </div>
      </div>
    </Shell>
  );
}
