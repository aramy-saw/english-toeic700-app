"use client";

/**
 * 復習カード一覧（docs/spec.md §13-7 c）。
 *
 * ★読むだけ。 削除・編集・タップ操作を作らない（step6.md §3 判断1・§13-1「静かな道具」）。
 *   カードが消えるのは「即答で正解して卒業したとき」だけ。手で消す導線は置かない。
 *
 * ★並びは updatedAt の新しい順。 直近で間違えた語が上に来る。
 */
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { AppBar } from "@/components/AppBar";
import { ReviewCardView } from "@/components/ReviewCard";
import {
  getPersistedSnapshot,
  getServerPersistedSnapshot,
  isBootSnapshot,
  subscribePersisted,
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
                  <ReviewCardView key={card.id} card={card} />
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
