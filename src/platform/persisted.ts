/**
 * localStorage を React から読むための外部ストア（docs/spec.md §12-2 の `boot`）。
 *
 * ★なぜ useEffect で読まないか。
 *   `useEffect` の中で setState すると React 19 の
 *   `react-hooks/set-state-in-effect` に触れる（段階3 で実測）。
 *   localStorage は「外部の可変ストア」なので、正しい道具は useSyncExternalStore。
 *
 * ★なぜスナップショットをキャッシュするか。
 *   getSnapshot は毎レンダー呼ばれる。毎回 JSON.parse して新しいオブジェクトを返すと
 *   参照が変わり続け、React が無限ループと判断する。
 *   だから**同じ参照を返し続け、書き込んだときだけ作り直す。**
 *
 * ★サーバー用スナップショットは固定の定数。
 *   SSR とハイドレーション直後はこれが返るので `boot`（保存値を描かない状態）になり、
 *   その直後にクライアントの実データで再描画される。ハイドレーション不一致が起きない。
 */
import type {
  CardMap,
  SessionRecord,
  Settings,
  WordStatMap,
} from "@/lib/types";
import {
  DEFAULT_SETTINGS,
  readCards,
  readSessions,
  readSettings,
  readWordStats,
  writeCards,
  writeSessions,
  writeSettings,
  writeWordStats,
} from "./storage";

export type Persisted = {
  settings: Settings;
  cards: CardMap;
  wordStats: WordStatMap;
  sessions: SessionRecord[];
};

/**
 * ★サーバー側と boot のスナップショット。**必ずこの同じ参照を返す。**
 *   毎回新しいオブジェクトを作るとハイドレーションのたびに再描画が走る。
 */
const SERVER_SNAPSHOT: Persisted = {
  settings: DEFAULT_SETTINGS,
  cards: {},
  wordStats: {},
  sessions: [],
};

let snapshot: Persisted | null = null;
const listeners = new Set<() => void>();

function readAll(): Persisted {
  return {
    settings: readSettings(),
    cards: readCards(),
    wordStats: readWordStats(),
    sessions: readSessions(),
  };
}

export function getPersistedSnapshot(): Persisted {
  snapshot ??= readAll();
  return snapshot;
}

export function getServerPersistedSnapshot(): Persisted {
  return SERVER_SNAPSHOT;
}

/** boot かどうか。まだクライアントの実データを読んでいない状態 */
export function isBootSnapshot(p: Persisted): boolean {
  return p === SERVER_SNAPSHOT;
}

export function subscribePersisted(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * 書き込みと通知。**localStorage と React の両方を1回で更新する。**
 * 片方だけ更新する経路を作らないため、書き込み口はここ1つに絞る。
 */
export function writePersisted(patch: Partial<Persisted>): void {
  const current = getPersistedSnapshot();
  const next: Persisted = { ...current, ...patch };

  if (patch.settings !== undefined) writeSettings(next.settings);
  if (patch.cards !== undefined) writeCards(next.cards);
  if (patch.wordStats !== undefined) writeWordStats(next.wordStats);
  if (patch.sessions !== undefined) writeSessions(next.sessions);

  // ★writeSessions は 50件に切り詰めるので、書いた値をそのまま信じずに読み直す
  snapshot = readAll();
  for (const l of listeners) l();
}
