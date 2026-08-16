import { describe, expect, it } from "vitest";
import {
  loadWordlist,
  normalizePos,
  parseMeaningParts,
  parseSimilar,
} from "@/lib/wordlist";

/**
 * なぜテストすべきか：
 * 配布データの「区切り文字」と「型」を STEP 1 の実測で3件も読み違えていた
 * （docs/data-findings.md §2）。ここを間違えると下流の誤答生成が全滅する。
 * 実測した事実を固定して、二度と取り違えないようにする。
 */

describe("normalizePos", () => {
  it('"動詞/名詞" の主要品詞は verb（先頭トークン）', () => {
    // なぜ：複合品詞35語の判定方針。先頭が主要用法という解釈を固定する
    expect(normalizePos("動詞/名詞").pos).toBe("verb");
    expect(normalizePos("動詞/名詞").posAll).toEqual(["verb", "noun"]);
  });

  it('"名詞/動詞" の主要品詞は noun（順序が主要用法を示す）', () => {
    // なぜ：「動詞/名詞」と「名詞/動詞」が別々に存在する＝順序に意味がある。
    //       ここが逆になると pos_mismatch の診断が反転する
    expect(normalizePos("名詞/動詞").pos).toBe("noun");
    expect(normalizePos("名詞/動詞").posAll).toEqual(["noun", "verb"]);
  });

  it('"名詞句" は noun に寄せる', () => {
    // なぜ：名詞句6語はすべてL3。noun に寄せないと誤答の供給元から外れる
    expect(normalizePos("名詞句").pos).toBe("noun");
  });
});

describe("parseSimilar", () => {
  it("カンマ区切りの文字列を分割し、trim して小文字化する", () => {
    // なぜ：similar は配列ではなく文字列（300語すべて str）。
    //       配列として .forEach すると即 TypeError になる
    expect(parseSimilar("supply, offer, give")).toEqual([
      "supply",
      "offer",
      "give",
    ]);
  });
});

describe("parseMeaningParts", () => {
  it('"・" で分割する（"/" ではない）', () => {
    // なぜ：pos の区切りは "/"、meaning の区切りは "・"。取り違えると
    //       ブロック条件5（meaning の共通要素）が機能しない
    expect(parseMeaningParts("促進する・容易にする")).toEqual([
      "促進する",
      "容易にする",
    ]);
  });
});

describe("loadWordlist", () => {
  it("配布データ全300件を読み込み、7フィールドが揃っている", () => {
    // なぜ：配布データの健全性。件数が変わっていたら前提が崩れている
    const wl = loadWordlist();
    expect(wl.entries).toHaveLength(300);
    for (const e of wl.entries) {
      expect(typeof e.id).toBe("number");
      expect(e.word).toBeTruthy();
      expect(e.posRaw).toBeTruthy();
      expect(e.meaning).toBeTruthy();
      expect([1, 2, 3]).toContain(e.level);
      expect(e.exampleScene).toBeTruthy();
      expect(Array.isArray(e.similar)).toBe(true);
    }
  });
});
