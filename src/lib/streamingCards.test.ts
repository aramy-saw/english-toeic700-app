import { describe, expect, it } from "vitest";
import { extractPartial } from "./streamingCards";

/**
 * ストリーミング中の**部分的な JSON** から、確定したものだけを取り出す純関数。
 *
 * ★AI が何を書いたかはテストしない。 テストするのは
 *   「どこまで届いた文字列を、どう解釈するか」という状態遷移だけ。
 *   入力は固定の文字列なので、LLM を呼ばずに全部書ける。
 *
 * ★確定していないものは絶対に出さない。 中途半端なカードを表示すると、
 *   文字が伸びていく様子が見えてしまい「計器」ではなくなる（§13-1）。
 */
describe("extractPartial", () => {
  it("空文字なら何も取れない", () => {
    expect(extractPartial("")).toEqual({ patternSummary: null, cards: [] });
  });

  it("pattern_summary が閉じていないうちは null", () => {
    const s = '{"pattern_summary":"意味の記憶が';
    expect(extractPartial(s).patternSummary).toBeNull();
  });

  it("pattern_summary が閉じたら取れる", () => {
    const s = '{"pattern_summary":"意味の記憶があいまいです","review_cards":[';
    expect(extractPartial(s).patternSummary).toBe("意味の記憶があいまいです");
  });

  it("エスケープされた引用符で早く閉じたと誤判定しない", () => {
    const s = '{"pattern_summary":"彼は\\"available\\"を選んだ","review_cards":[]}';
    expect(extractPartial(s).patternSummary).toBe('彼は"available"を選んだ');
  });

  it("カードが1件閉じたらその1件だけ取れる", () => {
    const s =
      '{"pattern_summary":"x","review_cards":[' +
      '{"id":4,"word":"available","explanation":"e","usage_note":"u","example_en":"a","example_ja":"b"},' +
      '{"id":48,"word":"appro';
    const out = extractPartial(s);
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0]).toMatchObject({ id: 4, word: "available" });
  });

  it("2件目が閉じたら2件になる（増分で増えていく）", () => {
    const head =
      '{"pattern_summary":"x","review_cards":[' +
      '{"id":4,"word":"a","explanation":"e","usage_note":"u","example_en":"x","example_ja":"y"}';
    const two =
      head +
      ',{"id":48,"word":"b","explanation":"e","usage_note":"u","example_en":"x","example_ja":"y"}';

    expect(extractPartial(head).cards).toHaveLength(1);
    expect(extractPartial(two).cards).toHaveLength(2);
  });

  it("文字列の中の } や { を構造と誤認しない", () => {
    const s =
      '{"pattern_summary":"x","review_cards":[' +
      '{"id":1,"word":"w","explanation":"括弧 { と } を含む","usage_note":"u","example_en":"x","example_ja":"y"}]}';
    const out = extractPartial(s);
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0]).toMatchObject({ explanation: "括弧 { と } を含む" });
  });

  it("完全な JSON なら全件取れる", () => {
    const s = JSON.stringify({
      pattern_summary: "s",
      review_cards: [1, 2, 3].map((id) => ({
        id,
        word: `w${id}`,
        explanation: "e",
        usage_note: "u",
        example_en: "x",
        example_ja: "y",
      })),
      next_message: "n",
      suggested_tempo: "none",
    });
    const out = extractPartial(s);
    expect(out.patternSummary).toBe("s");
    expect(out.cards).toHaveLength(3);
  });

  it("review_cards がまだ現れていなければカードは0件", () => {
    expect(extractPartial('{"pattern_summary":"s"').cards).toEqual([]);
  });

  it("壊れた JSON でも例外を投げず、取れる分だけ返す", () => {
    const s = '{"review_cards":[{"id":1,,,},{"id":2,"word":"ok"}';
    expect(() => extractPartial(s)).not.toThrow();
    expect(extractPartial(s).cards).toHaveLength(1);
  });

  it("pattern_summary が review_cards より後ろにあっても取れる", () => {
    const s = '{"review_cards":[],"pattern_summary":"あとから来た"}';
    expect(extractPartial(s).patternSummary).toBe("あとから来た");
  });
});
