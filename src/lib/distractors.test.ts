import { describe, expect, it } from "vitest";
import { buildChoices } from "@/lib/distractors";
import { loadWordlist } from "@/lib/wordlist";
import type { Rng } from "@/lib/types";

/**
 * なぜテストすべきか（このファイルが最重要）：
 * 不良問題が1つでも混ざると「間違えた原因が確定する」というこのアプリの
 * 唯一の売りが崩れる。鈴木さんが迷うのが正しい場面で weak_memory と
 * 診断するのは誤診断であり、②を解いていることにならない。
 */

const fixedRng = (): Rng => {
  let i = 0;
  return () => ((i++ * 13) % 100) / 100;
};

/**
 * ★loadWordlist() をトップレベルで呼ばない。
 * 未実装のあいだ collection 時に throw し、ファイルごと落ちて
 * 個々のテスト名が登録されなくなるため（実際に踏んだ）。
 */
const load = () => loadWordlist();
const pick = (wl: ReturnType<typeof loadWordlist>, id: number) => {
  const e = wl.byId.get(id);
  if (!e) throw new Error(`id=${id} が見つからない`);
  return e;
};

describe("buildChoices", () => {
  it("誤答に similar 由来の語が絶対に入らない", () => {
    // なぜ：similar は類義語。並べると両方正解になる（§4 発見1）
    const wl = load();
    for (const quiz of wl.entries) {
      const choices = buildChoices(quiz, wl.entries, fixedRng());
      expect(choices).not.toBeNull();
      for (const c of choices!) {
        if (c.isCorrect) continue;
        const src = pick(wl, c.sourceId);
        expect(quiz.similar).not.toContain(src.wordKey);
        expect(src.similar).not.toContain(quiz.wordKey);
        expect(src.similar.some((s) => quiz.similar.includes(s))).toBe(false);
      }
    }
  });

  it("誤答に出題語と同じ word が入らない（word重複26語対策）", () => {
    // なぜ：mutual(192) の問題に mutual(279) が出ると両方正解に見える（§4 発見3）
    const wl = load();
    for (const quiz of wl.entries) {
      const choices = buildChoices(quiz, wl.entries, fixedRng());
      for (const c of choices!) {
        if (c.isCorrect) continue;
        expect(pick(wl, c.sourceId).wordKey).not.toBe(quiz.wordKey);
      }
    }
  });

  it("誤答の meaning が出題語の meaning と共通要素を持たない（不良問題6組対策）", () => {
    // なぜ：facilitate「促進する・容易にする」× expedite「促進する・迅速に処理する」
    //       のような組。迷うのが正しいのに weak_memory と診断されてしまう（§4 発見4）
    const wl = load();
    for (const quiz of wl.entries) {
      const choices = buildChoices(quiz, wl.entries, fixedRng());
      for (const c of choices!) {
        if (c.isCorrect) continue;
        const src = pick(wl, c.sourceId);
        expect(src.meaningParts.some((m) => quiz.meaningParts.includes(m))).toBe(
          false,
        );
      }
    }
  });

  it("★300語すべてについて誤答が3つ生成できる", () => {
    // なぜ：全件検証。1語でも欠けたらその語で4択が成立せず出題できない
    const wl = load();
    for (const quiz of wl.entries) {
      const choices = buildChoices(quiz, wl.entries, fixedRng());
      expect(choices, `id=${quiz.id} ${quiz.word} で誤答が組めない`).not.toBeNull();
      expect(choices!).toHaveLength(4);
      expect(choices!.filter((c) => c.isCorrect)).toHaveLength(1);
      expect(choices!.filter((c) => !c.isCorrect)).toHaveLength(3);
    }
  });

  it("★id=4 available（形容詞・L1）で4択が成立する", () => {
    // なぜ：形容詞×L1 が自分1語だけ。誤答B が構成不能でフォールバックが必ず発火する
    //       （docs/data-findings.md §7）。現状の挙動を固定する
    const wl = load();
    const choices = buildChoices(pick(wl, 4), wl.entries, fixedRng());
    expect(choices).not.toBeNull();
    expect(choices!).toHaveLength(4);
    expect(choices!.some((c) => c.fallbackTier > 0)).toBe(true);
  });

  it("★id=48 approximately（副詞・L2）で4択が成立する", () => {
    // なぜ：副詞が全300語で自分1語だけ。誤答B も C も構成不能な唯一の語。
    //       フォールバックの最終段まで落ちる境界（docs/data-findings.md §7）
    const wl = load();
    const choices = buildChoices(pick(wl, 48), wl.entries, fixedRng());
    expect(choices).not.toBeNull();
    expect(choices!).toHaveLength(4);
    expect(choices!.some((c) => c.fallbackTier > 0)).toBe(true);
  });

  it("同じ意味の選択肢が2つ以上出ない", () => {
    // なぜ：4択の成立条件。表示テキストが重複すると選びようがない
    const wl = load();
    for (const quiz of wl.entries) {
      const choices = buildChoices(quiz, wl.entries, fixedRng());
      const texts = choices!.map((c) => c.text);
      expect(new Set(texts).size).toBe(texts.length);
    }
  });
});
