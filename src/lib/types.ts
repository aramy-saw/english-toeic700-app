/**
 * ドメイン型のみ。ロジックを置かない。
 * 定義の根拠は docs/spec.md §3（ドメイン型）と §9-2（localStorage スキーマ）。
 */

export type WordId = number;
export type Level = 1 | 2 | 3;
export type PosTag = "noun" | "verb" | "adj" | "adv";
export type TempoId = "slow" | "normal" | "fast";
export type Cause = "pos_mismatch" | "weak_memory" | "hesitant";

/** 0以上1未満を返す乱数。src/lib/ は Math.random を直接呼ばず、これを引数で受け取る */
export type Rng = () => number;

/**
 * src/data/wordlist.json の生の1件。絶対に書き換えない。
 * `& Record<string, unknown>` は、提出後のカスタム版で追加フィールドを足しても
 * 型エラーにならないようにするため（docs/prompts/step3.md §3-1）。
 */
export type RawWordEntry = {
  id: number;
  word: string;
  pos: string; // "名詞/動詞" など。区切りは "/"
  meaning: string; // "予定・スケジュールを組む" など。区切りは "・"
  level: number;
  example_scene: string;
  similar: string; // ★配列ではない。"supply, offer, give"
} & Record<string, unknown>;

/** アプリ内で扱う正規化済みエントリ */
export type WordEntry = {
  id: WordId;
  word: string;
  /** word.trim().toLowerCase()。word重複26語の同一判定に使う */
  wordKey: string;
  /** 原文保持。AIプロンプトにはこちらを渡す */
  posRaw: string;
  /** 先頭トークン＝主要品詞。誤答A/B/Cの判定に使う唯一の値 */
  pos: PosTag;
  /** 全トークン。フォールバック時のみ使う */
  posAll: PosTag[];
  meaning: string;
  /** 「・」分割。ブロック条件5に使う */
  meaningParts: string[];
  level: Level;
  exampleScene: string;
  /** カンマ分割・trim・小文字化済み */
  similar: string[];
  isCustom: boolean;
};

export type ChoiceRole = "correct" | "A" | "B" | "C";

export type Choice = {
  choiceId: string;
  /** その意味の出典語 */
  sourceId: WordId;
  /** 表示する日本語 meaning */
  text: string;
  isCorrect: boolean;
  /**
   * ★生成時に埋め込む。回答後に pos を比較して再計算しない（docs/spec.md §6-3）。
   * 正解肢は null。
   */
  causeIfChosen: Cause | null;
  role: ChoiceRole;
  /** 0=第1段で取れた, 1..=フォールバックで緩めた段。検証用 */
  fallbackTier: number;
};

export type Question = { entry: WordEntry; choices: Choice[] };

export type AnsweredQuestion = {
  question: Question;
  /** null = 無回答 */
  selectedChoiceId: string | null;
  responseMs: number | null;
  isCorrect: boolean;
  isInstant: boolean;
  /** 正解かつ即答なら null（＝復習対象外） */
  cause: Cause | null;
};

export type SessionSummary = {
  questionCount: number;
  score: number;
  maxScore: number;
  accuracyRate: number; // 0..1
  instantRate: number; // 0..1
  causeCounts: Record<Cause, number>;
};

/** state==="ready" のとき非 null */
export type CardContent = {
  causeLabel: string;
  explanation: string;
  usageNote: string;
  exampleEn: string;
  exampleJa: string;
  filledAt: number;
};

export type ReviewCard = {
  /** ★カードキーは id。mutual(192) と mutual(279) は別カード */
  id: WordId;
  word: string;
  /** 同名語を区別するため保持 */
  meaning: string;
  level: Level;
  /** 最新の確定原因 */
  cause: Cause;
  state: "pending" | "ready";
  /** 誤答した累計 */
  missCount: number;
  /** 正解したが即答できなかった累計 */
  hesitantCount: number;
  /** pending 送信順の基準 */
  createdAt: number;
  updatedAt: number;
  /**
   * ★state==="pending" でも content が非 null の組み合わせは仕様上正当。
   * docs/spec.md §11「cause が変わったら state を pending に戻す（content は残す）」。
   * 判別可能ユニオンに締めてはいけない。
   */
  content: CardContent | null;
};

/** キーは idKey(id)（= String(WordId)）。localStorage が JSON なので実行時は必ず string */
export type CardMap = Record<string, ReviewCard>;

export type WordStat = {
  seenCount: number;
  correctCount: number;
  instantCorrectCount: number;
  lastSeenAt: number;
};

/** キーは idKey(id) */
export type WordStatMap = Record<string, WordStat>;
