"use client";

/**
 * 復習カード一覧（docs/spec.md §13-7 c）。
 *
 * ★消す以外の操作は作らない（§13-1「静かな道具」）。編集もタップでの出題も無い。
 *   当初は「読むだけ」だったが、**枚数が増え続けると一覧として機能しなくなる**ため、
 *   1枚ずつ消す導線だけを足した（§12-8・2026-08-18）。
 *
 * ★消すのはカードだけ。 出題対象からは外さない。また間違えれば作り直される。
 *
 * ★並びは updatedAt の新しい順。 直近で間違えた語が上に来る。
 */
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { AppBar } from "@/components/AppBar";
import { ReviewCardView } from "@/components/ReviewCard";
import { removeCard } from "@/lib/reviewCards";
import {
  getPersistedSnapshot,
  getServerPersistedSnapshot,
  isBootSnapshot,
  subscribePersisted,
  writePersisted,
} from "@/platform/persisted";

export function ReviewRoot() {
  const persisted = useSyncExternalStore(
    subscribePersisted,
    getPersistedSnapshot,
    getServerPersistedSnapshot,
  );

  const booting = isBootSnapshot(persisted);
  const cards = Object.values(persisted.cards).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppBar right="復習" />

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* boot 中は localStorage 由来の値を描かない。枚数も出さない（§12-2） */}
        {!booting && (
          /*
           * ★中央寄せだけ。--content-max-y は付けない（2026-08-17 実機で修正）。
           *   カードは何十枚にもなりうる可変長の内容で、上限を付けると
           *   560px で頭打ちになって残りが読めなくなる。
           *   my-auto は内容が画面を超えれば自動的に 0 に潰れ、普通に上詰め＋スクロールになる。
           *   件数で分岐を書く必要はない。
           */
          <div className="app-shell my-auto flex w-full flex-col gap-[var(--s5)] py-[var(--s5)]">
            <p className="en text-[56px] leading-[1.05]">{cards.length}枚</p>

            {/*
             * ★0枚のときは何も足さない（§13-1 必要なことだけ出す）。
             *   「0枚」という数字自体が状態を語っている。
             *   結果画面で review_cards が0枚のとき何も出さないのと同じ判断。
             */}
            {cards.length > 0 && (
              <div className="flex flex-col gap-[var(--s3)]">
                {cards.map((card) => (
                  <ReviewCardView
                    key={card.id}
                    card={card}
                    /*
                     * ★書き込み口は writePersisted 1つ（persisted.ts）。
                     *   localStorage と React の両方が同時に更新されるので、
                     *   枚数の表示（「7枚」）も同じ描画で更新される。
                     *   件数を別に持っていないので、ズレようがない。
                     */
                    onDelete={() =>
                      writePersisted({
                        cards: removeCard(getPersistedSnapshot().cards, card.id),
                      })
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* 戻るだけ。ここに操作を増やさない */}
      <div
        className="border-t border-line bg-bg"
        style={{
          paddingBottom: "calc(var(--s6) + env(safe-area-inset-bottom))",
        }}
      >
        <div className="app-shell pt-[var(--s4)]">
          <Link
            href="/"
            className="flex h-[52px] items-center justify-center rounded-r2 border border-line text-[17px]"
          >
            ホームへ
          </Link>
        </div>
      </div>
    </div>
  );
}
