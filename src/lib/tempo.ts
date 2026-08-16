/**
 * テンポ（速度帯）の定義と閾値。
 *
 * 消費者は3つ（session.ts ではない）:
 *   1. diagnosis.ts        即答判定の本体
 *   2. UI ホーム画面        テンポ設定の3択表示（docs/spec.md §12-2）
 *   3. STEP 4 のAPI層       FeedbackRequest.tempoLabel / instantThresholdMs（§10-2）
 *
 * ★8/5/3秒はすべて暫定値。実装後に触って調整し、確定値と根拠を
 *   docs/decisions.md に追記する。
 */
import type { TempoId } from "./types";

export const TEMPO_THRESHOLD_MS: Readonly<Record<TempoId, number>> = {
  slow: 8000,
  normal: 5000,
  fast: 3000,
};

export const DEFAULT_TEMPO: TempoId = "normal";

/** 即答判定とは別の、無回答扱いにするハードキャップ */
export const NO_ANSWER_TIMEOUT_MS = 60000;

/**
 * 表示名。「初級・中級・上級」とは呼ばない
 * （配布データの level 1/2/3 と混同するため。docs/spec.md §8）
 */
const TEMPO_LABEL: Readonly<Record<TempoId, string>> = {
  slow: "ゆっくり",
  normal: "ふつう",
  fast: "はやい",
};

/** UI と AI プロンプトの両方が使う */
export function tempoLabel(tempo: TempoId): string {
  return TEMPO_LABEL[tempo];
}

/**
 * 即答かどうか。
 * spec.md §7-1「正解だが即答の閾値を超えた → hesitant」に従い、
 * 閾値ちょうど（例：ふつうで5000ms）は「超えていない」ので即答とする。
 * 無回答（null）は即答ではない。
 */
export function isInstant(responseMs: number | null, tempo: TempoId): boolean {
  if (responseMs === null) return false;
  return responseMs <= TEMPO_THRESHOLD_MS[tempo];
}
