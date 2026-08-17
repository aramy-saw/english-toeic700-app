"use client";

/**
 * `/` の状態機械（docs/spec.md §12-2）。
 *
 * ★page.tsx ではなくここが "use client" を持つ（§12-1）。
 *   page.tsx に付けると `/` 全体がクライアント境界になり、
 *   boot（SSR と同一の静的スケルトン）が作れなくなる。
 *
 * ★STEP 6 段階3 の範囲は boot / home / quiz。
 *   - home は「はじめる」だけの仮置き。前回SCORE・テンポ3択・/review は段階5
 *   - analyzing / result は段階4。ここでは通し終えたことが分かる最小表示だけ
 *   - localStorage への確定書き込みも段階4（§12-2 は quiz→analyzing で書くと定める）
 */

import { useRef, useState, type ReactNode } from "react";

import { AppBar } from "@/components/AppBar";
import { ChoiceButton, choiceStateOf } from "@/components/ChoiceButton";
import { Dock, DockButton } from "@/components/Dock";
import { ScoreStrip } from "@/components/ScoreStrip";
import { diagnose } from "@/lib/diagnosis";
import { toScoreMarks } from "@/lib/marks";
import { buildSession, summarize } from "@/lib/session";
import { isNoAnswer } from "@/lib/tempo";
import type { AnsweredQuestion, Question, Settings } from "@/lib/types";
import { loadWordlist } from "@/lib/wordlist";
import { monotonicNow } from "@/platform/clock";
import { rng } from "@/platform/rng";
import {
  DEFAULT_SETTINGS,
  readCards,
  readSettings,
  readWordStats,
} from "@/platform/storage";

/**
 * 配布300語の正規化はモジュール評価時に1回だけ。
 * 静的バンドルなので通信は起きない（§12-7「出題自体はオフラインでも動く」）。
 */
const WORDLIST = loadWordlist();

/**
 * ★§12-2 の `boot` が無い。
 *   boot は「localStorage 由来の値を描く前に SSR と同じ静的スケルトンを見せる」ための
 *   状態だが、段階3 の home はまだ保存値を1つも描かないので出番が無く、
 *   置いても常に素通りする空の状態にしかならない。
 *   home に前回SCORE を出す段階5 で、boot ごと useSyncExternalStore で入れる。
 */
type Phase = "home" | "quiz" | "analyzing";

export function QuizRoot() {
  const [phase, setPhase] = useState<Phase>("home");

  // §12-5「捨てる（React state）」に対応する。もう1セットでここだけ初期化する
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<AnsweredQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  /**
   * §12-5「保持する（React state）」。localStorage のインメモリミラー。
   *
   * ★読み込みは「はじめる」のハンドラ内で行う（下の startSession）。
   *   マウント時の useEffect で読むと `react-hooks/set-state-in-effect` に触れる。
   *   段階3 の home は localStorage 由来の値を1つも描かないので、
   *   描画前に読む必要が無く、ハンドラで読めば十分。
   */
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  // cards / wordStats はミラーを持たず、セッション開始時に読むだけ。
  // 書き戻し（applySessionToCards）が入る段階4 で state に載せる

  /**
   * 出題を表示した時刻（monotonicNow）。
   * ★描画に使わない値なので state ではなく ref。state にすると回答のたびに
   *   無駄な再描画が1回増える。
   */
  const questionStartedAt = useRef<number | null>(null);

  /**
   * ★シャッフルはイベントハンドラ内（§12-3）。StrictMode の二重実行を避ける。
   *
   * localStorage もここで読む。read* はクライアントでしか呼ばれないので
   * サーバー側で「今日」や保存値を触ることが構造的に起きない（§12-4）。
   */
  function startSession() {
    const loadedSettings = readSettings();
    const loadedCards = readCards();
    const loadedWordStats = readWordStats();

    setSettings(loadedSettings);

    const built = buildSession(
      { wordlist: WORDLIST, cards: loadedCards, wordStats: loadedWordStats },
      rng,
    );

    setQuestions(built);
    setAnswers([]);
    setCurrentIndex(0);
    questionStartedAt.current = monotonicNow();
    setPhase("quiz");
  }

  /**
   * 回答の確定。選択肢タップと「わからない」の両方がここに来る。
   * choiceId === null が「わからない」。
   *
   * ★経過時間が NO_ANSWER_TIMEOUT_MS を超えていたら無回答に倒す（§7-1）。
   *   タイマーで自動的に進めることはしない。通勤中に画面を伏せた人の問題を
   *   勝手に閉じないため、判定は回答したこの瞬間にだけ行う。
   */
  function answer(choiceId: string | null) {
    const question = questions[currentIndex];
    if (question === undefined) return;
    // 二重回答の防止。回答済みなら選択肢は disabled だが、状態側でも閉じておく
    if (answers.length > currentIndex) return;

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
      tempo: settings.tempo,
    });

    setAnswers((prev) => [
      ...prev,
      { question, selectedChoiceId, responseMs, ...result },
    ]);
  }

  function goNext() {
    if (currentIndex + 1 >= questions.length) {
      // 段階4 でここに localStorage への確定書き込みと AI 呼び出しが入る
      setPhase("analyzing");
      return;
    }
    setCurrentIndex((i) => i + 1);
    questionStartedAt.current = monotonicNow();
  }

  /** 中断。★何も保存しない（§12-2） */
  function quitToHome() {
    setQuestions([]);
    setAnswers([]);
    setCurrentIndex(0);
    questionStartedAt.current = null;
    setPhase("home");
  }

  if (phase === "home") return <HomeView onStart={startSession} />;
  if (phase === "analyzing") {
    return <AnalyzingStub answers={answers} onHome={quitToHome} />;
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
}: {
  right?: ReactNode;
  children: ReactNode;
  dock: ReactNode;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppBar right={right} />
      {/*
       * ★縦 flex にしてあるのは、中身の塊が `my-auto` で垂直中央に置けるようにするため。
       *   余った高さはこの main が持ち、塊の外側（上下）へ均等に出る。
       *   内容が画面を超えたときは my-auto が 0 に潰れて普通にスクロールする。
       */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </main>
      <Dock>{dock}</Dock>
    </div>
  );
}

/**
 * ★段階3 の仮置き。前回SCORE・テンポ3択・/review は段階5。
 *
 * ここが localStorage 由来の値を描かないので、SSR の出力と
 * ハイドレーション後の出力が必ず一致する（§12-2 の boot が要らない理由）。
 */
function HomeView({ onStart }: { onStart: () => void }) {
  return (
    <Shell dock={<DockButton label="はじめる" onClick={onStart} />}>
      <div className="app-shell py-[var(--s6)]">
        <p className="text-[26px] leading-[1.5]">なぜ間違えたかが、わかる。</p>
        <p className="mt-[var(--s5)] text-[16px] text-text-mute">
          前回の記録・テンポ設定・復習カードは段階5で入ります。
        </p>
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
       * ★mt-auto で余りを1箇所に集める作りをやめた理由（2026-08-17 実機確認）：
       *   画面が縦に長いほどその1箇所が青天井で伸び、PC の縦長ウィンドウで破綻する。
       *   上下2箇所に振り分けても、余りの絶対量が大きければ同じことが起きる。
       *   余りは「内部に配る」のではなく「塊の外に出す」のが正しい。
       *
       *   grow      … 空きがあれば --content-max-y まで伸びる
       *   max-h     … そこで止める。これ以上は内部の間隔を広げない
       *   my-auto   … 上限に達したあとの余りを上下へ均等に出し、塊を中央に置く
       *   shrink-0  … 画面が足りないときは縮めずに main 側をスクロールさせる
       *   justify-between … 上限までの空きを目盛り／出題語／4択のあいだで分け合う
       *   gap       … 分け合う前の最低間隔（32px）。空きが 0 でもここは詰まらない
       */}
      <div className="app-shell my-auto flex w-full max-h-[var(--content-max-y)] shrink-0 grow flex-col justify-between gap-[var(--s6)] py-[var(--s5)]">
        {/* 進捗バーを別に作らない。得点と同じ部品を使う（§13-8） */}
        <ScoreStrip
          marks={toScoreMarks(answers, questions.length)}
          showLegend={false}
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

        {/* 4択（§13-7 a・§12-7）。肢の間隔 8px。塊の下端＝ドックの直上 */}
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

/** ★段階4 で結果画面に置き換える。ここは通し終えたことの確認用 */
function AnalyzingStub({
  answers,
  onHome,
}: {
  answers: readonly AnsweredQuestion[];
  onHome: () => void;
}) {
  const s = summarize(answers);

  return (
    <Shell right="結果" dock={<DockButton label="ホームへ" onClick={onHome} />}>
      <div className="app-shell py-[var(--s6)]">
        <p className="en text-[56px] leading-[1.1]">{s.score}</p>
        <p className="en mt-[var(--s1)] text-[16px] text-text-sub">
          / {s.maxScore}
        </p>
        <div className="mt-[var(--s4)]">
          {/* 本数は実際の出題数。QUESTIONS_PER_SESSION を直接書かない */}
          <ScoreStrip marks={toScoreMarks(answers, answers.length)} showLegend />
        </div>
        <p className="mt-[var(--s5)] text-[16px] text-text-mute">
          結果画面と AI 分析は段階4で入ります。ここまでが段階3の範囲です。
        </p>
      </div>
    </Shell>
  );
}
