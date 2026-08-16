import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPO } from "@/lib/tempo";
import type { CardMap, SessionRecord, WordStatMap } from "@/lib/types";
import {
  DEFAULT_SETTINGS,
  MAX_SESSION_HISTORY,
  SCHEMA_VERSION,
  STORAGE_KEYS,
  readCards,
  readSessions,
  readSettings,
  readWordStats,
  writeCards,
  writeSessions,
  writeSettings,
  writeWordStats,
} from "./storage";
import type { StorageLike } from "./storage";

/**
 * localStorage は node 環境に無いので、テストは偽物を注入する（vitest の environment は node）。
 * 本番は globalThis.localStorage を既定で使う。
 */
class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** setItem が必ず失敗する環境（Safari プライベートモード・quota 超過）を模す */
class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new Error("getItem failed");
  }
  setItem(): void {
    throw new Error("quota exceeded");
  }
  removeItem(): void {
    throw new Error("removeItem failed");
  }
}

const card = (id: number): CardMap[string] => ({
  id,
  word: "overhead",
  meaning: "経費・間接費",
  level: 2,
  cause: "weak_memory",
  state: "pending",
  missCount: 1,
  hesitantCount: 0,
  createdAt: 1000,
  updatedAt: 1000,
  content: null,
});

const session = (finishedAt: number): SessionRecord => ({
  finishedAt,
  dateLabel: "2026-08-16",
  tempo: "normal",
  score: 72,
  maxScore: 100,
  questionCount: 10,
  accuracyRate: 0.9,
  instantRate: 0.54,
  aiStatus: "ready",
});

describe("保存と読込の往復", () => {
  it("settings が往復する", () => {
    const store = new MemoryStorage();
    writeSettings({ tempo: "fast" }, store);
    expect(readSettings(store)).toEqual({ tempo: "fast" });
  });

  it("cards が往復する", () => {
    const store = new MemoryStorage();
    const cards: CardMap = { "121": card(121) };
    writeCards(cards, store);
    expect(readCards(store)).toEqual(cards);
  });

  it("wordStats が往復する", () => {
    const store = new MemoryStorage();
    const stats: WordStatMap = {
      "1": { seenCount: 3, correctCount: 2, instantCorrectCount: 1, lastSeenAt: 500 },
    };
    writeWordStats(stats, store);
    expect(readWordStats(store)).toEqual(stats);
  });

  it("sessions が往復する", () => {
    const store = new MemoryStorage();
    const sessions = [session(2000), session(1000)];
    writeSessions(sessions, store);
    expect(readSessions(store)).toEqual(sessions);
  });

  it("封筒（v + data）の形で書き込む", () => {
    const store = new MemoryStorage();
    writeSettings({ tempo: "slow" }, store);

    const raw = store.getItem(STORAGE_KEYS.settings);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({
      v: SCHEMA_VERSION,
      data: { tempo: "slow" },
    });
  });
});

describe("キーが無いとき", () => {
  it("settings は既定値（ふつう）を返す", () => {
    const store = new MemoryStorage();
    expect(readSettings(store)).toEqual({ tempo: DEFAULT_TEMPO });
    expect(DEFAULT_SETTINGS).toEqual({ tempo: DEFAULT_TEMPO });
  });

  it("cards / wordStats は空オブジェクト、sessions は空配列を返す", () => {
    const store = new MemoryStorage();
    expect(readCards(store)).toEqual({});
    expect(readWordStats(store)).toEqual({});
    expect(readSessions(store)).toEqual([]);
  });
});

describe("バージョン不一致（docs/spec.md §9-4）", () => {
  it("初期値を返す", () => {
    const store = new MemoryStorage();
    store.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({ v: SCHEMA_VERSION + 1, data: { tempo: "fast" } }),
    );

    expect(readSettings(store)).toEqual({ tempo: DEFAULT_TEMPO });
  });

  it("そのキーを removeItem する（読むたびに捨て続けない）", () => {
    const store = new MemoryStorage();
    store.setItem(
      STORAGE_KEYS.cards,
      JSON.stringify({ v: SCHEMA_VERSION + 1, data: { "121": card(121) } }),
    );

    readCards(store);

    expect(store.getItem(STORAGE_KEYS.cards)).toBeNull();
  });

  it("v が無い（封筒でない）値も初期値に落とす", () => {
    const store = new MemoryStorage();
    store.setItem(STORAGE_KEYS.cards, JSON.stringify({ "121": card(121) }));

    expect(readCards(store)).toEqual({});
  });
});

describe("壊れた値でも例外を投げない（docs/spec.md §9-5）", () => {
  it("JSON としてパースできない値は初期値になる", () => {
    const store = new MemoryStorage();
    store.setItem(STORAGE_KEYS.cards, "{壊れている");

    expect(() => readCards(store)).not.toThrow();
    expect(readCards(store)).toEqual({});
  });

  it("data の型が違う（配列であるべき所が文字列）値は初期値になる", () => {
    const store = new MemoryStorage();
    store.setItem(
      STORAGE_KEYS.sessions,
      JSON.stringify({ v: SCHEMA_VERSION, data: "こわれている" }),
    );

    expect(readSessions(store)).toEqual([]);
  });

  it("data の型が違う（オブジェクトであるべき所が配列）値は初期値になる", () => {
    const store = new MemoryStorage();
    store.setItem(
      STORAGE_KEYS.cards,
      JSON.stringify({ v: SCHEMA_VERSION, data: [] }),
    );

    expect(readCards(store)).toEqual({});
  });

  it("getItem 自体が throw しても初期値を返す", () => {
    const store = new ThrowingStorage();
    expect(() => readSettings(store)).not.toThrow();
    expect(readSettings(store)).toEqual({ tempo: DEFAULT_TEMPO });
  });
});

describe("書き込みの失敗（docs/spec.md §9-5）", () => {
  it("setItem が throw してもセッションを止めない", () => {
    const store = new ThrowingStorage();
    expect(() => writeCards({ "121": card(121) }, store)).not.toThrow();
    expect(() => writeSettings({ tempo: "fast" }, store)).not.toThrow();
  });
});

describe("store が無いとき（SSR・localStorage 不在）", () => {
  it("読み出しは初期値を返す", () => {
    expect(readSettings(null)).toEqual({ tempo: DEFAULT_TEMPO });
    expect(readCards(null)).toEqual({});
    expect(readSessions(null)).toEqual([]);
  });

  it("書き込みは何もしない（例外も投げない）", () => {
    expect(() => writeSessions([session(1)], null)).not.toThrow();
  });
});

describe("sessions のトリム（docs/spec.md §9-3）", () => {
  it("MAX_SESSION_HISTORY 件を超えたら先頭から切る", () => {
    const store = new MemoryStorage();
    // 新しい順に並んでいる前提。finishedAt は 100, 99, 98, ... と降順
    const many = Array.from({ length: MAX_SESSION_HISTORY + 10 }, (_, i) =>
      session(1000 - i),
    );

    writeSessions(many, store);
    const read = readSessions(store);

    expect(read).toHaveLength(MAX_SESSION_HISTORY);
    expect(read[0].finishedAt).toBe(1000);
    expect(read[MAX_SESSION_HISTORY - 1].finishedAt).toBe(
      1000 - (MAX_SESSION_HISTORY - 1),
    );
  });

  it("上限ちょうどなら切らない", () => {
    const store = new MemoryStorage();
    const exact = Array.from({ length: MAX_SESSION_HISTORY }, (_, i) =>
      session(1000 - i),
    );

    writeSessions(exact, store);

    expect(readSessions(store)).toHaveLength(MAX_SESSION_HISTORY);
  });
});
