/**
 * localStorage の読み書き（docs/spec.md §9）。
 *
 * ★このファイルだけが localStorage を触る。src/lib/ は純関数のまま保つ。
 *
 * 規律（§9-5）:
 * - すべての読み出しは呼び出し側の useEffect 内で行う。初回描画はSSRと一致させる
 * - 書き込みは try/catch。Safari プライベートモードや quota 超過で setItem が throw する。
 *   失敗してもセッションは続行する（メモリ上の state が正）
 * - JSON パース失敗も catch して初期値
 *
 * バージョニング（§9-4）:
 * - v !== SCHEMA_VERSION なら初期値を返し、そのキーを removeItem する
 * - ★破棄したことを UI に出さない。ホームが初期状態に戻るのが唯一の兆候
 */
import { DEFAULT_TEMPO } from "@/lib/tempo";
import type {
  CardMap,
  SessionRecord,
  Settings,
  WordStatMap,
} from "@/lib/types";

export const SCHEMA_VERSION = 1;

/** sessions のみトリムする（§9-3）。cards は卒業で減るので上限管理は不要 */
export const MAX_SESSION_HISTORY = 50;

export const STORAGE_KEYS = {
  settings: "english700:settings",
  cards: "english700:cards",
  wordStats: "english700:wordStats",
  sessions: "english700:sessions",
} as const;

/**
 * localStorage のうち、このファイルが使う3メソッドだけを要求する。
 * テストが偽物を注入できるようにするため（vitest の environment は node で
 * localStorage が存在しない）。
 */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const DEFAULT_SETTINGS: Settings = { tempo: DEFAULT_TEMPO };

/**
 * 既定の保存先。SSR や localStorage が使えない環境では null を返す。
 * localStorage へのアクセス自体が throw する環境があるので try で包む。
 */
function defaultStore(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 封筒（{ v, data }）を読み、中身を返す。
 *
 * 初期値に落ちる条件は4つ。いずれも例外を投げない:
 *   1. キーが無い
 *   2. JSON としてパースできない
 *   3. 封筒の形をしていない（v が数値でない）
 *   4. v !== SCHEMA_VERSION → ★このときだけ removeItem する（§9-4）
 *
 * ★data の中身は「型の骨格」だけ検査する（isValid）。
 *   各フィールドの妥当性までは見ない。壊れた値で UI が落ちないための最低限であり、
 *   スキーマ検証ではない。
 */
function read<T>(
  key: string,
  fallback: T,
  isValid: (v: unknown) => boolean,
  store: StorageLike | null,
): T {
  if (store === null) return fallback;

  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }

  if (!isRecord(parsed) || typeof parsed.v !== "number") return fallback;

  if (parsed.v !== SCHEMA_VERSION) {
    // 変換チェーンは書かない。捨てて初期値に戻す（§9-4）
    try {
      store.removeItem(key);
    } catch {
      // 消せなくても読み出しは初期値でよい
    }
    return fallback;
  }

  if (!isValid(parsed.data)) return fallback;

  return parsed.data as T;
}

/** 書き込みは失敗しても握りつぶす。メモリ上の state が正（§9-5） */
function write<T>(key: string, data: T, store: StorageLike | null): void {
  if (store === null) return;
  try {
    store.setItem(key, JSON.stringify({ v: SCHEMA_VERSION, data }));
  } catch {
    // quota 超過・プライベートモード。セッションは続行する
  }
}

// ── settings ──

export function readSettings(
  store: StorageLike | null = defaultStore(),
): Settings {
  return read<Settings>(
    STORAGE_KEYS.settings,
    DEFAULT_SETTINGS,
    (v) => isRecord(v),
    store,
  );
}

export function writeSettings(
  settings: Settings,
  store: StorageLike | null = defaultStore(),
): void {
  write(STORAGE_KEYS.settings, settings, store);
}

// ── cards ──

export function readCards(store: StorageLike | null = defaultStore()): CardMap {
  return read<CardMap>(STORAGE_KEYS.cards, {}, (v) => isRecord(v), store);
}

export function writeCards(
  cards: CardMap,
  store: StorageLike | null = defaultStore(),
): void {
  write(STORAGE_KEYS.cards, cards, store);
}

// ── wordStats ──

export function readWordStats(
  store: StorageLike | null = defaultStore(),
): WordStatMap {
  return read<WordStatMap>(
    STORAGE_KEYS.wordStats,
    {},
    (v) => isRecord(v),
    store,
  );
}

export function writeWordStats(
  wordStats: WordStatMap,
  store: StorageLike | null = defaultStore(),
): void {
  write(STORAGE_KEYS.wordStats, wordStats, store);
}

// ── sessions ──

export function readSessions(
  store: StorageLike | null = defaultStore(),
): SessionRecord[] {
  return read<SessionRecord[]>(
    STORAGE_KEYS.sessions,
    [],
    (v) => Array.isArray(v),
    store,
  );
}

/**
 * ★新しい順で受け取り、先頭から MAX_SESSION_HISTORY 件だけ残す（§9-2・§9-3）。
 *   並べ替えはしない。呼び出し側が新しい順で渡す前提。
 */
export function writeSessions(
  sessions: readonly SessionRecord[],
  store: StorageLike | null = defaultStore(),
): void {
  write(STORAGE_KEYS.sessions, sessions.slice(0, MAX_SESSION_HISTORY), store);
}
