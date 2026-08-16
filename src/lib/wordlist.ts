/**
 * 配布データの読み込みと正規化。
 * ★wordlist.json を import するのはこのファイルだけ（唯一の読み込み口）。
 *
 * 区切り文字（docs/data-findings.md §2 の実測）:
 *   pos     → ASCII スラッシュ "/"   （"・" は0件）
 *   meaning → "・"                   （"/" は0件）
 *   similar → カンマ区切りの「文字列」（配列ではない）
 */
import rawWordlist from "@/data/wordlist.json";
import type { Level, PosTag, RawWordEntry, WordEntry, WordId } from "./types";

export const DISTRIBUTED_ID_MAX = 300;
export const CUSTOM_ID_BASE = 1001;

export const isCustomId = (id: WordId): boolean => id >= CUSTOM_ID_BASE;

export type Wordlist = {
  entries: WordEntry[];
  byId: ReadonlyMap<WordId, WordEntry>;
  byLevel: ReadonlyMap<Level, WordEntry[]>;
};

/** 実測11値をすべて網羅する。名詞句は noun に寄せる */
const POS_MAP: Readonly<Record<string, PosTag>> = {
  名詞: "noun",
  名詞句: "noun",
  動詞: "verb",
  形容詞: "adj",
  副詞: "adv",
};

/**
 * 複合品詞は「先頭トークンを主要品詞」とする（docs/spec.md §4-1）。
 * 実データの区切りは "/" だが、記載揺れに備えて "・"・"、"・"," も受ける。
 * 未知トークンは throw せず noun に寄せる（配布データを実行時に落とす価値がない）。
 */
export function normalizePos(raw: string): { pos: PosTag; posAll: PosTag[] } {
  const tokens = raw
    .split(/[/・、,]/)
    .map((t) => t.trim())
    .filter(Boolean);

  const posAll: PosTag[] = [];
  for (const t of tokens) {
    const mapped = POS_MAP[t];
    if (mapped && !posAll.includes(mapped)) posAll.push(mapped);
  }

  if (posAll.length === 0) return { pos: "noun", posAll: ["noun"] };
  return { pos: posAll[0], posAll };
}

/** カンマ区切りの「文字列」を分割する。配列ではない */
export function parseSimilar(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** meaning の区切りは "・"（pos の "/" と取り違えない） */
export function parseMeaningParts(raw: string): string[] {
  return raw
    .split("・")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function toWordEntry(raw: RawWordEntry): WordEntry {
  const { pos, posAll } = normalizePos(raw.pos);
  return {
    id: raw.id,
    word: raw.word,
    wordKey: raw.word.trim().toLowerCase(),
    posRaw: raw.pos,
    pos,
    posAll,
    meaning: raw.meaning,
    meaningParts: parseMeaningParts(raw.meaning),
    level: raw.level as Level,
    exampleScene: raw.example_scene,
    similar: parseSimilar(raw.similar),
    isCustom: isCustomId(raw.id),
  };
}

export function loadWordlist(raw?: RawWordEntry[]): Wordlist {
  const source = raw ?? (rawWordlist as RawWordEntry[]);
  const entries = source.map(toWordEntry);

  const byId = new Map<WordId, WordEntry>();
  const byLevel = new Map<Level, WordEntry[]>([
    [1, []],
    [2, []],
    [3, []],
  ]);

  for (const e of entries) {
    byId.set(e.id, e);
    byLevel.get(e.level)?.push(e);
  }

  return { entries, byId, byLevel };
}
