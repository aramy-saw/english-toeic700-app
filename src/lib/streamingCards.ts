/**
 * ストリーミング中の**部分的な JSON** から、確定したものだけを取り出す（docs/spec.md §12-6 d）。
 *
 * ★なぜ自前で書くか。
 *   Anthropic SDK は structured outputs の**途中経過をパースしてくれない**。
 *   `stream.on("text")` で届くのは JSON の文字列断片だけで、
 *   `parsed_output` は最終メッセージにしか付かない（SDK の型で確認）。
 *   1枚ずつ表示するには、増えていく文字列から完成した部分を自分で取り出すしかない。
 *
 * ★確定していないものは絶対に出さない。
 *   閉じていない文字列・閉じていないオブジェクトは無視する。
 *   中途半端なカードを出すと、文字が伸びていく様子が見えて「計器」でなくなる（§13-1）。
 *
 * ★例外を投げない。 壊れた断片は黙って捨てる。
 *   ここで落ちると画面全体が止まる。最終的な正しさは
 *   `validateAiResponse`（V1〜V5）が完了時に担保する。
 */

/** JSON 文字列リテラルを読む。閉じていなければ null */
function readString(src: string, openQuote: number): { value: string; end: number } | null {
  let i = openQuote + 1;
  let out = "";
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      // エスケープ列は2文字で1つ。途中で切れていたら未確定
      if (i + 1 >= src.length) return null;
      const esc = src[i + 1];
      if (esc === "u") {
        if (i + 5 >= src.length) return null;
        out += JSON.parse(`"\\u${src.slice(i + 2, i + 6)}"`) as string;
        i += 6;
        continue;
      }
      const map: Record<string, string> = {
        '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t",
      };
      out += map[esc] ?? esc;
      i += 2;
      continue;
    }
    if (ch === '"') return { value: out, end: i };
    out += ch;
    i += 1;
  }
  return null; // 閉じていない
}

/** `"key"` の直後にある文字列値を取り出す。未確定なら null */
function readStringField(src: string, key: string): string | null {
  const at = src.indexOf(`"${key}"`);
  if (at === -1) return null;

  let i = at + key.length + 2;
  while (i < src.length && (src[i] === " " || src[i] === ":")) i += 1;
  if (i >= src.length || src[i] !== '"') return null;

  return readString(src, i)?.value ?? null;
}

/**
 * `"review_cards"` の配列から、**閉じているオブジェクトだけ**を取り出す。
 * 文字列リテラルの中の `{` `}` は構造として数えない。
 */
function readClosedObjects(src: string): unknown[] {
  const at = src.indexOf('"review_cards"');
  if (at === -1) return [];

  let i = src.indexOf("[", at);
  if (i === -1) return [];
  i += 1;

  const out: unknown[] = [];
  while (i < src.length) {
    if (src[i] !== "{") {
      if (src[i] === "]") break;
      i += 1;
      continue;
    }

    const start = i;
    let depth = 0;
    let closed = -1;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '"') {
        const s = readString(src, i);
        if (s === null) return out; // 文字列が未確定＝このオブジェクトは未完成
        i = s.end + 1;
        continue;
      }
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          closed = i;
          break;
        }
      }
      i += 1;
    }
    if (closed === -1) return out; // 閉じていない

    try {
      out.push(JSON.parse(src.slice(start, closed + 1)));
    } catch {
      // 壊れた断片は捨てる。次のオブジェクトへ進む
    }
    i = closed + 1;
  }
  return out;
}

export type PartialResponse = {
  /** 確定していなければ null */
  patternSummary: string | null;
  /** 閉じたオブジェクトだけ。検証はまだ通っていない */
  cards: unknown[];
};

export function extractPartial(snapshot: string): PartialResponse {
  return {
    patternSummary: readStringField(snapshot, "pattern_summary"),
    cards: readClosedObjects(snapshot),
  };
}
