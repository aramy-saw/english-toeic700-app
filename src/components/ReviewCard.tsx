"use client";

/**
 * 復習カード1枚（docs/spec.md §13-7 c・§10-9）。
 * 結果画面と `/review` の両方が使う。**読むだけ。削除・編集を作らない**（step6.md §3 判断1）。
 *
 * ★state が pending でも content が非 null はありうる（§11）。
 *   cause が変わって pending に戻ったカードは、古い説明を出したまま次回差し替える。
 *   「何も読めない状態」を作らないための仕様なので、
 *   **state ではなく content の有無で描き分ける。**
 *
 * ★和訳は畳んでおく（§10-9 の分割理由1）。
 *   英文を読んでから訳を見る順序を作る。開くのは読み手の操作。
 */
import { useState } from "react";

import { causeLabel } from "@/lib/diagnosis";
import type { ReviewCard as Card } from "@/lib/types";

export function ReviewCardView({ card }: { card: Card }) {
  const [showJa, setShowJa] = useState(false);
  const content = card.content;

  return (
    <article className="rounded-r2 border border-line bg-surface p-[var(--s4)]">
      {/*
       * ★見出しと原因タグを横に並べない（2026-08-17 実機で修正）。
       *   横並びだと長い見出しが「設置・インスト / ール」のように折れたうえ、
       *   右上に浮いたタグとの関係が読めなくなる。
       *   縦に分ければ、どちらも幅いっぱいを使えて折り返しが素直になる。
       */}
      <header>
        <h3 className="text-[17px] leading-[1.5]">
          <span className="en">{card.word}</span>
          <span className="text-text-sub"> — {card.meaning}</span>
        </h3>
        {/* 原因ラベルは色で語らせない。文字で出す（§13-9） */}
        <p className="mt-[var(--s2)]">
          <span className="inline-block rounded-r1 border border-line px-[var(--s2)] text-[16px] text-text-sub">
            {causeLabel(card.cause)}
          </span>
        </p>
      </header>

      {content === null ? (
        // ★失敗の報告ではなく予定の告知（§10-6）。謝らない
        <p className="mt-[var(--s3)] text-[16px] text-text-mute">
          説明は次回のセッションで追加されます
        </p>
      ) : (
        <div className="mt-[var(--s3)] flex flex-col gap-[var(--s3)]">
          {/* cause が変わって pending に戻っているあいだも、古い説明は読める（§11） */}
          {card.state === "pending" && (
            <p className="text-[16px] text-text-mute">説明を更新中です</p>
          )}

          <p className="text-[17px]">{content.explanation}</p>
          <p className="text-[16px] text-text-sub">
            使い分け：{content.usageNote}
          </p>

          <div>
            <p className="en text-[17px] leading-[1.6]">{content.exampleEn}</p>
            {showJa ? (
              <p className="mt-[var(--s2)] text-[16px] text-text-sub">
                {content.exampleJa}
              </p>
            ) : (
              // ★下線を付けない（2026-08-17 実機で修正）。
              //   下線はリンク＝別の場所へ移動する合図であり、
              //   その場で開くトグルには誤った予告になる。
              //   代わりに枠で「押せる面」だと示す。選択肢ボタンと同じ語彙。
              <button
                type="button"
                onClick={() => setShowJa(true)}
                className="mt-[var(--s2)] min-h-[44px] rounded-r2 border border-line px-[var(--s3)] text-[16px] text-text-sub transition-colors duration-[120ms] active:bg-ok-fill"
              >
                和訳を見る
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
