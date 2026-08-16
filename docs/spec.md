# ENGLISH700 仕様書（STEP 1 要件定義の成果物）

作成日：2026-08-16
位置づけ：手順書 STEP 1-5 の出力。STEP 1-4「Plan Mode で詰めるべきこと」7項目の確定版。
設計判断の背景は Obsidian の `ENGLISH700_構想と方針.md`、確定値の記録は今後 `docs/decisions.md`。

---

## 1. 概要

| 項目 | 内容 |
|---|---|
| アプリ名 | ENGLISH700 |
| 何をするもの | TOEIC700点突破を目指す社会人向け英単語アプリ |
| 想定ユーザー | 32歳・会社員の鈴木さん。通勤30分＋昼休み15分。過去に英単語アプリを3日で挫折 |
| 解く課題 | 業界3課題のうち **②間違えた原因がわからない** に一点集中（①③は既存要素で成立させる） |

### 必須要件（3つ）

- 配布された300語のJSONを使った出題機能
- Claude API を使ったフィードバック機能を1つ以上
- 1回のプレイが10問前後で終わる

---

## 2. 技術スタックと三層ディレクトリ

```
Next.js 16（App Router）+ TypeScript + Tailwind v4 + Vercel
API Routes で APIキーをサーバー側に隠す
データは src/data/wordlist.json（静的・300語・書き換え禁止）
進捗保存は localStorage（DB不要・認証不要）
AI は Claude API / claude-sonnet-5（環境変数 AI_MODEL で切替可）
```

| 層 | 責務 | 依存してよいもの |
|---|---|---|
| `src/lib/` | 純粋TS。テスト対象 | なし（DOM・fetch・乱数・時刻を**引数で受け取る**） |
| `src/lib/prompts/` | プロンプト組み立ての純関数。**プロンプトの正典** | 同上 |
| `src/platform/` | ブラウザ固有 | localStorage / Date.now / performance.now / Math.random / fetch |
| `src/app/` | 画面・API Route | すべて |

**原則**：`src/lib/` は `Math.random()` も `Date.now()` も直接呼ばない。`shuffle(arr, rng)` のように注入する。これによりテストが決定論的になる。

### モジュール分割

```
src/lib/
  types.ts        ドメイン型のみ
  wordlist.ts     JSON読込・pos正規化・similar/meaningパース・索引
  tempo.ts        テンポ定義と閾値定数
  scoring.ts      配点定数・SCORE/正解率/即答率の算出
  distractors.ts  ブロックリスト・誤答A/B/C生成・フォールバック
  session.ts      QUESTIONS_PER_SESSION / LEVEL_RATIO / 枠配分 / 出題語選定
  diagnosis.ts    cause 確定
  reviewCards.ts  復習カードのリデューサ・MAX_PENDING_PER_CALL
  aiResponse.ts   AI応答の検証とカード反映
  shuffle.ts      RNGを引数で受ける純粋シャッフル
  prompts/
    feedback.ts   プロンプト本文（正典）
    schema.ts     出力JSON Schema
src/platform/
  storage.ts      localStorage 読み書き＋バージョン検査
  clock.ts        now() / todayJst()
  rng.ts          Math.random ラッパ
  feedbackClient.ts  fetch('/api/feedback')
src/app/
  page.tsx        薄い Server Component
  QuizRoot.tsx    "use client" 状態機械の本体
  review/page.tsx 復習カード一覧
  api/feedback/route.ts
```

---

## 3. ドメイン型

```ts
export type WordId = number;
export type Level = 1 | 2 | 3;
export type PosTag = "noun" | "verb" | "adj" | "adv";
export type TempoId = "slow" | "normal" | "fast";
export type Cause = "pos_mismatch" | "weak_memory" | "hesitant";

/** src/data/wordlist.json の生の1件。絶対に書き換えない */
export type RawWordEntry = {
  id: number;
  word: string;
  pos: string;            // "名詞/動詞" など。区切りは "/"
  meaning: string;        // "予定・スケジュールを組む" など。区切りは "・"
  level: number;
  example_scene: string;
  similar: string;        // ★配列ではない。"supply, offer, give"
};

export type WordEntry = {
  id: WordId;
  word: string;
  wordKey: string;        // word.trim().toLowerCase()。26重複語の同一判定に使う
  posRaw: string;         // 原文保持。AIプロンプトにはこちらを渡す
  pos: PosTag;            // 先頭トークン＝主要品詞。誤答A/B/C判定に使う唯一の値
  posAll: PosTag[];       // 全トークン。フォールバック時のみ使う
  meaning: string;
  meaningParts: string[]; // 「・」分割。ブロック条件5に使う
  level: Level;
  exampleScene: string;
  similar: string[];      // カンマ分割・trim・小文字化済み
  isCustom: boolean;      // id >= CUSTOM_ID_BASE
};

export type Choice = {
  choiceId: string;            // "c0".."c3"
  sourceId: WordId;            // その意味の出典語
  text: string;                // 表示する日本語 meaning
  isCorrect: boolean;
  causeIfChosen: Cause | null; // 正解肢は null。★生成時に埋め込む
  role: "correct" | "A" | "B" | "C";
  fallbackTier: number;        // 0=第1段, 1..=緩めた段。検証用
};

export type Question = { entry: WordEntry; choices: Choice[] };

export type AnsweredQuestion = {
  question: Question;
  selectedChoiceId: string | null;  // null = 無回答
  responseMs: number | null;
  isCorrect: boolean;
  isInstant: boolean;
  cause: Cause | null;              // 正解かつ即答なら null（＝復習対象外）
};

export type SessionSummary = {
  questionCount: number;
  score: number;
  maxScore: number;
  accuracyRate: number;   // 0..1
  instantRate: number;    // 0..1
  causeCounts: Record<Cause, number>;
};
```

---

## 4. 配布データの正規化ルール

### 4-1. `pos` 正規化（実測11値すべて）

手順：
1. `raw.split(/[\/・、,]/)` — 実データは `/` のみだが防御的に複数受ける
2. 各トークンを `trim()`
3. 辞書で `PosTag` に変換：`名詞→noun` / `名詞句→noun` / `動詞→verb` / `形容詞→adj` / `副詞→adv`
4. 重複除去して `posAll`。**`posAll[0]` を `pos`（主要品詞）とする**
5. 未知トークンは throw せず `noun` にフォールバック（配布データを実行時に落とす価値がない）

| posRaw | 件数 | pos（主要） | posAll |
|---|---|---|---|
| 名詞 | 114 | noun | [noun] |
| 動詞 | 89 | verb | [verb] |
| 形容詞 | 55 | adj | [adj] |
| 動詞/名詞 | 15 | verb | [verb, noun] |
| 名詞/動詞 | 11 | noun | [noun, verb] |
| 名詞句 | 6 | noun | [noun] |
| 名詞/形容詞 | 4 | noun | [noun, adj] |
| 動詞/形容詞 | 2 | verb | [verb, adj] |
| 形容詞/名詞 | 2 | adj | [adj, noun] |
| 副詞 | 1 | adv | [adv] |
| 形容詞/副詞 | 1 | adj | [adj, adv] |

→ 正規化後の主要品詞分布：**noun 135 / verb 106 / adj 58 / adv 1**

**「先頭トークンを主要品詞にする」根拠**：「動詞/名詞」15語と「名詞/動詞」11語が別々に存在する＝作成者が主要用法を先に書いていると解釈できる。全トークン交差方式は、名詞と動詞の区別＝まさに `pos_mismatch` で測りたいものを潰すため不採用。実測でも主要品詞方式のほうが誤答を組めない語が少ない（2語 対 7語）。

### 4-2. `similar` / `meaning` のパース

- `similar`：**カンマ区切りの文字列**。`split(",")` → `trim()` → `toLowerCase()`
- `meaning`：**`・` 区切り**。`split("・")` → `trim()`
- **`pos` は `/`、`meaning` は `・`。取り違えると両方壊れる**

### 4-3. id 採番方針

```ts
export const DISTRIBUTED_ID_MAX = 300;
export const CUSTOM_ID_BASE = 1001;
export const isCustomId = (id: WordId) => id >= CUSTOM_ID_BASE;
```

- 配布データは 1〜300（全ユニーク・実測確認済み）
- 自作語は **1001 から**。`WordId = number` を維持でき、localStorage 既存データとも互換
- `id < 1000` = 配布（書き換え禁止）、`id >= 1001` = 自作、と境界に意味を持たせる
- 自作語は `src/data/custom-words.json` を新規作成し `loadWordlist` が concat する。**配布ファイルは一切触らない**
- 提出版では自作語を追加しない（時間予算）。方針のみ確定

---

## 5. セッション組み立て

### 5-1. 定数

```ts
// src/lib/session.ts
export const QUESTIONS_PER_SESSION = 10;
export const LEVEL_RATIO: Readonly<Record<Level, number>> = { 1: 1, 2: 4, 3: 5 };
```

**コードのどこにも数値 `10` を直書きしない。** 満点も `maxScore(questions.length)` で算出。

### 5-2. 枠配分＝最大剰余法（ハミルトン方式）

1. `raw[L] = total * RATIO[L] / ΣRATIO`
2. `slots[L] = floor(raw[L])`
3. 残余 `rem = total - Σslots`
4. 小数部の**降順**に1枠ずつ配る
5. **同値タイブレークは level の降順（L3 → L2 → L1）**

タイブレークをL3優先にする根拠：目的がTOEIC700突破であり、L3は150語＝プール最大かつ伸びしろが大きい。L1は40語しかなく枠を増やすと枯渇が早い。

実測（定数を変えるだけで自動追従することを確認済み）：

| total | L1 | L2 | L3 |
|---|---|---|---|
| **10（提出版）** | **1** | **4** | **5** |
| 12 | 1 | 5 | 6 |
| 13 | 1 | 5 | 7 |
| 15 | 1 | 6 | 8 |
| **20（自分用）** | **2** | **8** | **10** |

### 5-3. 優先ティア（level枠内で優先）

| tier | 定義 | 判定 |
|---|---|---|
| 0 | 復習カードが存在する語 | `cards[String(id)]` が存在 |
| 1 | 未学習語 | `wordStats[String(id)]` が存在しない |
| 2 | 出題済み語 | `wordStats` にあり、カードが無い |

tier内の並び：

- tier 0：`missCount` 降順 → `updatedAt` 昇順 → **同値（tie）の中だけシャッフル**
- tier 1：全体をシャッフル（ソートキーなし）
- tier 2：`lastSeenAt` 昇順 → **同値（tie）の中だけシャッフル**

**★シャッフルの適用範囲（2026-08-16 明確化）**

tier 0 と tier 2 のシャッフルは、**ソートキーがすべて等しい語どうしの並びを決めるためだけ**に使う。
**ソート結果全体をシャッフルし直してはならない。**

そうしないと「間違えた回数が多い語を優先」「久しく見ていない語を優先」という
ソートキーの指定が無意味になり、tier 分けそのものが機能しなくなる。
シャッフルの役目は同着の解消のみ。

（tier 1 だけは全体シャッフルでよい。ソートキーが無く、同着しかないため。）

復習カードが0件なら全部が tier 1 なので、初回は分岐が実質発生しない。

> **記法の揺れについて（同じ間違いを繰り返さないための記録）**
> §6-2 P5 は「**各段の中は**シャッフルして1件取る」と適用範囲を明示していたが、
> 本節は当初「`lastSeenAt` 昇順 → シャッフル」とだけ書いており、
> 「ソート後に全体をシャッフルする」とも読めてしまった（STEP 3 のテスト作成時に判明）。
> **矢印で処理を並べるときは、シャッフルやランダム化の適用範囲を必ず明示すること。**

### 5-4. 選定手順

```
S1. slots = allocateLevelSlots(questionCount, LEVEL_RATIO)
S2. usedWordKeys = Set<string>()、picked = []
S3. L1 → L2 → L3 の順に処理（L1は40語で最も枯渇しやすいので先に確保）
      候補を tier順に並べ、上から:
        枠が埋まったら break
        usedWordKeys に既にあれば skip（セッション内 word 重複禁止）
        buildChoices() が null なら skip（誤答が組めない語）
        採用して usedWordKeys に追加
      deficit[L] = 埋まらなかった数
S4. 補充パス：L3 → L2 → L1 の順に、tier順・未使用・choices構成可の語で deficit を埋める
      （プールが大きく目標帯である L3 から埋める）
S5. それでも足りなければ、その長さでセッションを成立させる
      questions.length を唯一の真実として進捗・満点・スコアを駆動する
      ★word 重複を許して埋めることは絶対にしない
        （同一セッションで overhead が2回出ると「さっき見た」記憶で解けてしまい cause が汚れる）
S6. picked 全体をシャッフルして出題順を決める（レベル順に並ばないように）
```

**枯渇の見立て**：L1は40語/1問＝40セッション、L2は110語/4問＝27セッション、L3は150語/5問＝30セッション。ほぼ揃っているので枠が埋まらない事態は「同一セッション内の `word` 衝突」でしか起きず、S4の補充で即座に埋まる。

**未学習／出題済みの追跡**：`wordStats` に `id` をキーとして記録。**出題時ではなく回答確定時に書く**（電車で中断されたセッションを「学習済み」にしない）。

---

## 6. 誤答生成

### 6-1. ブロックリスト（**5条件**）

候補 `c` は以下のいずれかに当たれば除外：

1. `c.id === quiz.id`
2. `c.wordKey === quiz.wordKey` — 26重複語対策（§4 発見3）
3. `quiz.similar` に `c.wordKey` が含まれる
4. `c.similar` に `quiz.wordKey` が含まれる、または `quiz.similar ∩ c.similar ≠ ∅`
5. **`quiz.meaningParts ∩ c.meaningParts ≠ ∅`** — 意味の部分一致対策（§4 発見4）

条件5の根拠：`meaning` が交差する組は全32組あり、そのうち**6組は条件1〜4では捕まらない**（全ペア一覧は `docs/data-findings.md` §5）。

`facilitate`「促進する・容易にする」に対し `expedite`「促進する・迅速に処理する」が誤答に出ると、鈴木さんが「促進する」を見て迷うのは**正しい判断**であり、それを `weak_memory` と診断するのは誤診断になる。本アプリの唯一の売りが「原因が確定すること」なので看過できない。6組すべてが同じ主要品詞なので、誤答B・誤答Cの候補として実際に選ばれる。

実測での追加コスト：

| | 平均ブロック数 | 誤答Aが空 | 誤答Bが空 | 誤答Cが空 |
|---|---|---|---|---|
| 4条件 | 1.73語/出題語 | 0語 | 2語 | 1語 |
| **5条件（採用）** | 1.77語/出題語 | 0語 | 2語 | 1語 |

**条件5を足しても、バケットが空になる語は1語も増えない**（該当は §6-4 の2語のみ）。実質タダで6組の誤診断を防げる。

### 6-2. 生成手順とフォールバック段位

```
P1. pool = 全エントリ − ブロックされた語
P2. 誤答A（pos_mismatch を成立させる）
      A1: pool ∩ { c.pos !== quiz.pos }            実測300語すべてで非空
      A2: pool 全体（到達しない想定）              causeIfChosen は weak_memory にする
P3. 誤答B（同pos・同level）
      B1: pool ∩ { c.pos === quiz.pos && c.level === quiz.level }
      B2: pool ∩ { c.pos === quiz.pos && |c.level − quiz.level| === 1 }   levelを隣接帯に緩める
      B3: pool ∩ { c.posAll ∩ quiz.posAll ≠ ∅ && c.level === quiz.level } 複合品詞まで許す
      B4: pool 全体                                                        最終手段
P4. 誤答C（同pos・別level）
      C1: pool ∩ { c.pos === quiz.pos && c.level !== quiz.level }
      C2: pool ∩ { c.pos === quiz.pos }（B と別id）                        levelの差を諦める
      C3: pool ∩ { c.posAll ∩ quiz.posAll ≠ ∅ }
      C4: pool 全体                                                        最終手段
P5. A/B/C は互いに id 重複させない。重複したら同じ段の次候補へ
      各段の中はシャッフルして1件取る（毎回同じ誤答が出ないように）
P6. 最終段まで落ちて0件なら null を返す（呼び出し側が出題語をスキップ）
P7. 正解1＋誤答3 をシャッフルして Choice[] にする
```

### 6-3. `cause` は選択肢に埋め込む（重要）

`cause` は**回答後に pos を比較して再計算しない**。**生成時点で `Choice.causeIfChosen` に埋め込む**。

これにより B4/C4 の最終手段で品詞が崩れても、その肢は生成意図どおり `weak_memory` として扱われる。`diagnosis.ts` は「選ばれた肢の `causeIfChosen` を読むだけ」の純関数になり、テストが容易になる。

### 6-4. ★フォールバックが必ず発火する2語（実測）

| 語 | 状況 | 発火する段 |
|---|---|---|
| id=4 `available`（形容詞・L1） | 形容詞×L1 が自分1語だけ → B1 が空 | **B2**（形容詞のL2から取る） |
| id=48 `approximately`（副詞・L2） | 副詞が全300語で自分1語だけ → B1〜B3・C1〜C3 すべて空 | **B4 / C4**。この語だけ3肢とも品詞が異なる |

**フォールバックは例外処理ではなく通常フロー。** この2語を STEP 3 のテストケースに固定する。

---

## 7. 診断（cause）とスコア

### 7-1. cause 確定

| 状態 | cause |
|---|---|
| 正解 かつ 即答 | `null`（復習対象外） |
| 正解 だが 即答でない | `hesitant` |
| 誤答（誤答Aを選択） | `pos_mismatch` |
| 誤答（誤答B/Cを選択） | `weak_memory` |
| 無回答・タイムアウト | `weak_memory` |

### 7-2. SCORE

```ts
export const POINTS = { instantCorrect: 10, slowCorrect: 5, wrong: 0 } as const;
export function maxScore(questionCount: number) { return questionCount * POINTS.instantCorrect; }
```

配点（10/5/0）は固定値。満点のみ問題数から算出。

画面表示は3つセット。大きい数字が結果、小さい2つがその内訳＝診断。

```
    72点
  正解率 90%   即答率 54%
```

テンポが違うと得点が比較できないため、履歴には必ずテンポをセットで記録し、画面でも得点の横に小さく出す（例：`72点 ふつう`）。

---

## 8. テンポ（速度帯）

```ts
export const TEMPO_THRESHOLD_MS: Readonly<Record<TempoId, number>> = {
  slow: 8000, normal: 5000, fast: 3000,
};
export const DEFAULT_TEMPO: TempoId = "normal";
export const NO_ANSWER_TIMEOUT_MS = 60000;  // 即答判定とは別のハードキャップ
```

| TempoId | 表示 | 即答の閾値 |
|---|---|---|
| slow | ゆっくり | 8秒 |
| normal | ふつう（既定） | 5秒 |
| fast | はやい | 3秒 |

- **3つの秒数は暫定。** 実装後に自分で触って調整し、確定値と根拠を `docs/decisions.md` に残す
- 「初級・中級・上級」とは呼ばない（配布データの level 1/2/3 と混同するため）。**内部IDも表示も**この禁止に従う
- 起動時にテンポを選ばせない。localStorage に保存し、既定は「ふつう」。起動したらそのまま出題が始まる。変更は設定から
- 応答時間の計測は `performance.now()`（`Date.now()` はNTP補正で巻き戻りうる）
- テンポ閾値は**即答判定専用**。強制打ち切りには使わない。無回答は `NO_ANSWER_TIMEOUT_MS` と「わからない」ボタンで作る（通勤中の中断を誤答にしないため）

---

## 9. localStorage スキーマ

### 9-1. キーと封筒

```ts
type Envelope<T> = { v: number; data: T };
export const SCHEMA_VERSION = 1;

const KEYS = {
  settings:  "english700:settings",
  cards:     "english700:cards",
  wordStats: "english700:wordStats",
  sessions:  "english700:sessions",
} as const;
```

4分割の根拠：セッション終了時の書き込みは cards / wordStats / sessions の3つ、設定は別タイミング。1キーにまとめると設定変更のたびにカード全体を stringify することになる。語ごとに300キーへ分割すると列挙コストが増える。4キーが均衡点。

### 9-2. 型

```ts
// english700:settings
export type Settings = { tempo: TempoId };

// english700:cards   キーは String(WordId)
export type CardMap = Record<string, ReviewCard>;
export type ReviewCard = {
  id: WordId;            // ★カードキーは id。mutual(192) と mutual(279) は別カード
  word: string;
  meaning: string;       // 同名語を区別するため保持
  level: Level;
  cause: Cause;          // 最新の確定原因
  state: "pending" | "ready";
  missCount: number;     // 誤答した累計
  hesitantCount: number; // 正解したが即答できなかった累計
  createdAt: number;     // pending 送信順の基準
  updatedAt: number;
  content: CardContent | null;
};
export type CardContent = {
  causeLabel: string; explanation: string; usageNote: string;
  exampleEn: string; exampleJa: string; filledAt: number;
};

// english700:wordStats   キーは String(WordId)
export type WordStat = {
  seenCount: number; correctCount: number;
  instantCorrectCount: number; lastSeenAt: number;
};

// english700:sessions   新しい順・最大 MAX_SESSION_HISTORY 件
export type SessionRecord = {
  finishedAt: number;
  dateLabel: string;     // "2026-08-19"。★クライアントでJST算出
  tempo: TempoId;        // ★スコアと必ず対で保存
  score: number;
  maxScore: number;      // 問題数可変に耐える
  questionCount: number;
  accuracyRate: number;
  instantRate: number;
  aiStatus: "ready" | "pending";
};
export const MAX_SESSION_HISTORY = 50;
```

### 9-3. サイズ見積り

| キー | 1件 | 最大件数 | 合計 |
|---|---|---|---|
| cards | 400〜600B | 300 | 約180KB |
| wordStats | 約90B | 300 | 約27KB |
| sessions | 約200B | 50 | 10KB |

合計 **220KB未満**。上限5MBに対し十分。トリムは `sessions` のみ。cards は卒業で減るので上限管理は不要。

### 9-4. バージョニング：不一致なら破棄

`v !== SCHEMA_VERSION` なら初期値を返し、そのキーを `removeItem` する。

根拠：ユーザーは本人1名、提出まで数日、失われるのは自分の学習履歴のみ。変換チェーンを書く工数（およびそのバグを踏む工数）が得られる価値を上回る。

**ただし破棄したことをUIに出さない。**「データが消えました」は3日で飽きた人には最悪の体験。ホームが初期状態に戻るのが唯一の兆候。既知の制約として `docs/decisions.md` に記録する。

### 9-5. 読み書きの規律

- **すべての読み出しは `useEffect` 内**。初回描画はSSRと一致するスケルトンを出す
- **書き込みは try/catch**。Safariプライベートモードや quota 超過で `setItem` が throw する。失敗してもセッションは続行（メモリ上の state が正）
- JSONパース失敗も catch して初期値

---

## 10. AI 呼び出し

### 10-1. モデルと注意事項

**`claude-sonnet-5`**（環境変数 `AI_MODEL` で切替）。

- スキーマ強制は `output_config: { format: { type: "json_schema", schema } }`。旧 `output_format` は非推奨
- **全オブジェクトに `additionalProperties: false` が必要**
- **`maxLength` / `minLength` / `maxItems` / `minimum` / `maximum` は非対応。**「`pattern_summary` は1〜2文で」「**`review_cards` は最大5枚**」はプロンプト本文で指示する。`enum` と `anyOf` は使える
  - ★この「最大5枚」は**出力の `review_cards`** を指す。**入力の `pending` の上限（`MAX_PENDING_PER_CALL = 5`）とは別物**。詳細は §10-10
- **`temperature` / `top_p` / `top_k` は非デフォルト値を渡すと400エラー。** 渡さない
- **adaptive thinking がデフォルトON。** `max_tokens` は thinking と本文の合算上限なので余裕を持たせる（途中で切れると検証層がエラー扱いにする）
- 呼び出しは**10問終了後に1回だけ**。「もう1セット」をすれば2回目が発生する（1セット＝1回）

### 10-2. リクエスト（クライアント → `/api/feedback`）

```ts
export type FeedbackRequest = {
  session: {
    tempo: TempoId;
    tempoLabel: string;          // "ふつう"
    instantThresholdMs: number;  // 8000 | 5000 | 3000
    questionCount: number;
    score: number;
    maxScore: number;
    accuracyRate: number;
    instantRate: number;
    causeCounts: Record<Cause, number>;  // ★AIに数えさせない
  };
  results: Array<{
    id: WordId; word: string; pos: string;   // posRaw を渡す
    level: Level; meaning: string;
    similar: string[]; example_scene: string;
    selected_meaning: string | null;         // 無回答は null
    is_correct: boolean;
    is_instant: boolean;                     // ★閾値判定はアプリ側で済ませる
    response_ms: number | null;
    cause: Cause | null;
  }>;
  pending: Array<{                           // 最大5件、createdAt 昇順
    id: WordId; word: string; pos: string;
    level: Level; meaning: string;
    similar: string[]; example_scene: string;
    cause: Cause;
  }>;
};
```

**渡さないもの**：日付、localStorage 全体、セッション履歴、個人情報。

`causeCounts` を渡すのは「AIに原因を推測させない」原則の徹底。数え間違いは `pattern_summary` の説得力を直撃する。

### 10-3. レスポンス JSON Schema

```jsonc
{
  "type": "object",
  "additionalProperties": false,
  "required": ["pattern_summary", "review_cards", "next_message", "suggested_tempo"],
  "properties": {
    "pattern_summary": { "type": "string" },
    "review_cards": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id","word","explanation","usage_note","example_en","example_ja"],
        "properties": {
          "id":          { "type": "integer" },
          "word":        { "type": "string" },
          "explanation": { "type": "string" },
          "usage_note":  { "type": "string" },
          "example_en":  { "type": "string" },
          "example_ja":  { "type": "string" }
        }
      }
    },
    "next_message": { "type": "string" },
    "suggested_tempo": { "type": "string", "enum": ["slow","normal","fast","none"] }
  }
}
```

**`id` を必須にするのが要点。** `word` だけだと `mutual` が返ってきたとき 192 と 279 のどちらか判別できない。

**`cause_label` はスキーマに含めない（2026-08-16）。** cause から一意に決まる値なのでAIに生成させない。アプリ側が決定して `CardContent` に格納する。詳細は §10-9。

**`suggested_tempo` は4値 enum＋必須**にする。「省略できる」形にすると、省略が意図的だったのか出力漏れだったのか区別できない。変更不要なら `"none"` を明示させる。

### 10-4. `suggested_tempo` の発火条件

プロンプトで明示する条件：

| 状況 | 出力 |
|---|---|
| 現在 fast 以外 かつ 即答率 ≥ 0.8 かつ 正解率 ≥ 0.8 | `"fast"` |
| 現在 slow 以外 かつ 正解率 ≤ 0.5 | `"slow"` |
| 現在 normal 以外 かつ 上記に当たらず現テンポが明らかに不適合 | `"normal"` |
| 上記いずれにも当たらない | `"none"` |

**アプリ側の検証（AIを信用しない層）**：`aiResponse.ts` が以下を満たさない `suggested_tempo` を**黙って捨てる**（レスポンス全体は捨てない）。

1. `"none"` でない
2. 現在のテンポと異なる値
3. 上表の数値条件を、アプリが `SessionSummary` から**再計算して**満たしている

これで「AIの出力が実際にアプリ挙動を変える（＝独自性）」と「AIに推測させない（＝設計原則）」を両立する。

表示は結果画面の下部に1ボタン：**「次回から『はやい』にする」**。タップで `settings.tempo` を上書きし、ボタンは「変更しました」の静的テキストに置換（トーストは作らない）。

### 10-5. 検証層

```
V1. パース／スキーマ形状の検査。失敗 → 全体エラー
V2. presented = 今回の出題 id ∪ pending の id
      review_cards の各要素:
        id ∉ presented → ★レスポンス全体をエラー扱い
        word が byId.get(id).word と不一致 → 全体エラー
V3. 復習対象の語がすべて含まれるかは検査しない
      （欠けた語は pending のまま残り、次回の呼び出しで埋まる）
V4. suggested_tempo は §10-4 の条件で個別に捨てる（全体エラーにしない）
V5. 文字列長の上限クリップ（explanation 300字など）。表示崩れ防止
```

### 10-6. AI障害時（pending 方式）

AIが落ちてもアプリは死なない。SCORE・正誤・出題・テンポ・履歴はすべてアプリ側の計算なので動く。過去に保存済みの復習カードも読める。

- 復習対象2カテゴリ（間違えた語／正解したが即答できなかった語）のカードを**すべて pending で作成**
- 結果画面のエラー表示は**1行のみ**：「今日の分析は取得できませんでした」
- カード側の表示：「説明は次回のセッションで追加されます」（失敗の報告ではなく予定の告知）
- **謝罪文なし。再取得ボタンなし**（押したくなって待たされるため）
- 次にAIを呼ぶとき、その回の分に加えて pending を古い順に最大5件（`MAX_PENDING_PER_CALL`）渡す

### 10-7. Route Handler

`src/app/api/feedback/route.ts`

- `export const runtime = "nodejs"`、`export const maxDuration` を明示
- `process.env.ANTHROPIC_API_KEY`、`process.env.AI_MODEL ?? "claude-sonnet-5"`
- 入力を最小限バリデート（`results.length` が 1..40、`pending.length ≤ 5`）してから呼ぶ
- APIキー未設定時は500ではなく「pending方式に落とす」レスポンスを返す
- クライアント側にも `AbortController` で25秒のタイムアウトを置き、超えたら pending 方式に落ちる

### 10-8. AIの役割・口調・禁止事項（2026-08-16 確定）

出典：`ENGLISH700_開発手順書.md` STEP 4-1 より転記。

**役割の定義（最重要）**

AIに原因を「分析」させない。cause はアプリ側で確定済み。
AIの役割は「確定した原因を、鈴木さんの言葉で説明する」こと。

- 役割：TOEIC指導の経験が長い講師。EduBridge社の教育ノウハウを背景に持つ
- 相手：32歳会社員の鈴木さん。通勤30分＋昼休み15分。過去に3日で挫折
- 口調：励ましすぎない。事実を淡々と、しかし具体的に
- 禁止：「頑張りましょう」のような汎用的な励まし。一般論

**禁止事項（明文化）**

1. 原因の推測・言い換え。cause はアプリが確定した事実として扱い、
   AIはそれを覆したり別の原因を提示したりしない
2. 汎用的な励まし（「頑張りましょう」「その調子です」等）
3. 学習法の一般論（「毎日続けることが大切」等）
4. 語数・時間・スコアの創作。渡された数値以外を書かない

### 10-9. 各フィールドに何を書かせるか（2026-08-16 確定）

| フィールド | 内容 | 出典 |
|---|---|---|
| `cause_label` | 確定した cause の日本語表記（下表の固定文言）<br>※ `cause_label` はレスポンススキーマに含めない（2026-08-16）。AI は生成せず、アプリ側が cause から上表のマッピングで決定して `CardContent` に格納する。 | 本節で確定 |
| `explanation` | なぜ間違えたか／なぜ迷ったかの説明 | 手順書 STEP 4-1 |
| `usage_note` | `similar` を使った使い分けの説明 | 手順書 STEP 4-1 ／ 構想と方針.md §4発見1 |
| `example_en` | `example_scene` を使ったビジネス文脈の例文（英文） | 本節で確定 |
| `example_ja` | `example_en` の和訳 | 本節で確定 |

**`cause_label` の固定文言（AIに生成させない。アプリ側で決定して渡す）**

| cause | cause_label |
|---|---|
| `pos_mismatch` | 品詞の取り違え |
| `weak_memory` | 意味の記憶があいまい |
| `hesitant` | 思い出すのに時間がかかった |

理由：`cause_label` は cause の日本語表記であり、AIに生成させると呼び出しごとに
文言が揺れて同じ原因が別物に見える。「AIに原因を推測させない」原則（§10-2 の
`causeCounts` の項）の延長として、ラベルもアプリ側で確定させる。

**`example_en` / `example_ja` を分けた理由（2026-08-16 明確化）**

構想と方針.md・手順書はどちらも `example`（単数、英文＋和訳を1つに）だった。
spec.md で2フィールドに分割したが、両文書に分割理由の記述がなかったためここに明記する。

1. 和訳を別フィールドにすると、UI で英文を先に見せて和訳を後から開ける。
   課題①（覚えた→使えない）に対しては、まず英文で考えさせるほうが効く
2. 1フィールドに詰めると、文字数制御とパースが両方あいまいになる
3. STEP 3 で `CardContent` が `exampleEn` / `exampleJa` で確定済み

### 10-10. `review_cards` の枚数と優先順位（2026-08-16 確定）

**出力上限は5枚。**

§10-1 の「最大5枚」は `review_cards`（出力）を指す。
`MAX_PENDING_PER_CALL = 5` は `pending`（入力）の上限であり、**別物**である。

**優先順位**

1. `pending`（`createdAt` 昇順）
2. 今回の誤答（`is_correct = false`）
3. 今回の非即答正解（`is_correct = true` かつ `is_instant = false`）

上限に達した時点で打ち切る。§10-5 V3 のとおり、欠けた語は `pending` のまま残り、
次回の呼び出しで埋まる。

理由：

- 復習対象2カテゴリは10問中最大10語に達しうるが、15枚生成はレイテンシが読めず、
  `analyzing` 待機が長いと UX が崩れる
- `pending` を先に消化することでバックログの累積を防ぐ

**枚数の強制方法**

JSON Schema の `maxItems` は使えないため、二重で担保する。

1. プロンプト本文で「最大5枚」を明示
2. アプリ側で `slice(0, 5)`

---

## 11. 復習カードのライフサイクル

```
        [存在しない]
             │ 誤答 または（正解かつ非即答）
             ▼
        state="pending"  content=null
             │ AI応答が検証を通り、その id を含む
             ▼
        state="ready"    content={...}
             │ 即答 かつ 正解
             ▼
          [削除]（＝卒業）
```

### 遷移規則

| 回答結果 | 既存カードなし | 既存カードあり |
|---|---|---|
| 即答＋正解 | 何もしない（wordStats のみ更新） | **カードを削除（卒業）** |
| 非即答＋正解 | pending で新規作成、`hesitantCount=1` | `hesitantCount++`、`updatedAt` 更新 |
| 誤答 | pending で新規作成、`missCount=1` | `missCount++`、`updatedAt` 更新 |
| 無回答 | 誤答と同じ | 誤答と同じ |

**既存カードの語をまた間違えたとき：再作成せず更新する。ただし cause が変わったら `state` を `pending` に戻す（`content` は消さずに残す）。**

- `missCount` が「何回も落としている語」という情報になり、tier 0 内の並べ替えに直接使える。作り直すと失われる
- cause が `hesitant` → `pos_mismatch` に変わった語は説明が的外れになる。pending に戻せば次回の呼び出しで差し替わる。その間、古い `content` は表示し続ける（何も読めない状態を作らない）。「説明を更新中です」の1行を添える
- cause が同じなら ready のまま

**卒業後にまた間違えた場合**：カードは既に無いので新規作成（`missCount=1` にリセット）。卒業履歴を残す機能は作らない（③の実感は「カードが減る」ことで足りており、専用画面を作らない方針に反する）。

**卒業条件の再確認**：正解しただけでは消さない。**即答で正解**して初めて卒業。テンポの閾値をそのまま使う。

**表示（`/review`）**：ready と pending を混在させ、状態を**文字で**示す。26重複語対策として見出しは `word` に `meaning` の先頭要素を併記（例 `overhead — 経費`）。pending を上に、`missCount` 降順。件数を上部に大きく出す。ページングやフィルタは作らない。

---

## 12. 画面構成

### 12-1. ルーティング

- `/` … `page.tsx` は薄い Server Component。`<QuizRoot />`（`"use client"`）を返すだけ。**乱数も日付もサーバー側で触らない**
- `/review` … 別ルート。復習カード一覧
- `/api/feedback` … Route Handler

### 12-2. `/` の状態機械

```
boot ──(localStorage読込完了)──▶ home
home ──(「はじめる」タップ)────▶ quiz        ★ここで出題語生成＋シャッフル
quiz ──(最終問題の回答確定)────▶ analyzing   ★ここでlocalStorageへ確定書き込み
analyzing ──(AI成功 or 失敗)───▶ result
result ──(「もう1セット」タップ)▶ quiz        ★リセット
result ──(「ホームへ」タップ)──▶ home
quiz ──(「やめる」タップ)──────▶ home        ★中断。何も保存しない
```

| 状態 | 表示 |
|---|---|
| `boot` | SSRと同一の静的スケルトン。localStorage 由来の値を一切描かない |
| `home` | 直近SCORE（`72点 ふつう`）／復習カード枚数／**「はじめる」大ボタン**／テンポ設定（3択・現在値を文字で表示）／`/review` へのリンク |
| `quiz` | 進捗 `3 / 10`／英単語（大）／4択（縦積み・タップ領域大）／「わからない」ボタン。回答後は正誤を**文字と記号**で即表示 |
| `analyzing` | **唯一の演出箇所。** SCORE を先に数字で見せながらAI待ち（体感待ち時間をゼロにする）。到着で pattern_summary を差し込む |
| `result` | SCORE大＋正解率/即答率小＋テンポラベル／pattern_summary／review_cards／next_message／`suggested_tempo` ボタン（条件を満たしたときのみ）／**「もう1セット」**／「ホームへ」 |

### 12-3. シャッフルの実行位置

**「はじめる」タップのイベントハンドラ内**で実行する。**`useEffect` では実行しない。**

React 19 の StrictMode は開発時に `useEffect` を2回実行するため、`useEffect` で出題を組むと1回目が捨てられ、表示とログがズレる。イベントハンドラなら1回しか走らず、かつ確実にマウント後（サーバーでは実行されない）。

`analyzing` でのAI呼び出しは `useEffect` で行うが、`useRef` のガードで二重送信を防ぐ（StrictMode対策＝そのままコスト対策）。

### 12-4. 「今日」の算出位置

`src/platform/clock.ts` の `todayJst()` のみが日付を作る。**必ずクライアントから呼ぶ。** 実装は `Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo" })` で `YYYY-MM-DD` を生成する（`new Date().toISOString().slice(0,10)` は UTC になるので使わない）。用途は `SessionRecord.dateLabel` のみ。Server Component からは1箇所も呼ばない。

### 12-5. 「もう1セット」のリセット仕様

| | 対象 |
|---|---|
| **捨てる（React state）** | `questions` / `answers` / `currentIndex` / `questionStartedAt` / `feedback` / `aiError` / `suggestedTempoApplied` |
| **保持する（localStorage）** | `settings.tempo`（`suggested_tempo` 適用済みなら**新しい値でセット2が始まる**）／`cards`（前セットで生まれたカードを含む）／`wordStats`／`sessions`（前セットの記録は追加済み） |
| **保持する（React state）** | localStorage をミラーしているインメモリの cards / wordStats / settings。再読込は不要 |

**前セットで出た語は除外しない。** むしろ前セットで落とした語はカードができて tier 0 になっているため、2セット目に優先して再登場し、そこで即答正解すれば**そのセットで卒業する**。これは「今日これをやれば前進している」実感に直結する意図した仕様。

**セッション履歴の粒度：1セット＝1レコード。** 2セットを合算すると200点満点になり、過去の100点満点レコードと比較不能になる。`maxScore` をレコードに持たせているのはこのため。

---

## 13. デザインの制約（評価項目4）

課題文の「凝ったデザインよりAPIの組み込みで差がつく」は**優先順位の話であってデザインを捨てる意味ではない**。評価項目4に配点がある。

守ること：

- 通勤電車・昼休みに**片手で使える**。タップ領域は44px以上、フォントは16px以上（iOS Safari のズーム防止）
- 迷わない。テンポが良い。進捗が数字で見える
- 15分で1回分が終わる
- **背景は暗め固定**（通勤中・就寝前でも眩しくない）
- 差し色は2色まで
- **色だけに頼らず、文字でも状態が分かる**

**凝る場所は1箇所だけ：AIフィードバックが出る瞬間**（`analyzing` → `result`）。それ以外は「機能する最低限」。

---

## 14. デプロイ前チェックリスト

- [ ] `.env.local` に `ANTHROPIC_API_KEY`。`.gitignore` に `.env*` が入っていることを目で確認
- [ ] Vercelダッシュボードにも `ANTHROPIC_API_KEY` と `AI_MODEL` を設定（変更後は再デプロイ）
- [ ] 環境変数名に `NEXT_PUBLIC_` が付いていない
- [ ] クライアントから `api.anthropic.com` を直接叩いていない
- [ ] `layout.tsx` の `metadata.title` が `Create Next App` のままでない。`lang="ja"`
- [ ] `globals.css` の `prefers-color-scheme` を外して暗色固定にした
- [ ] JST 0〜9時の時間帯でも日付がずれないことを確認

---

## 15. この方法では見えないもの（限界）

- **セッション途中の離脱で結果は消える。** 出題状態を React state のみで持つのは「単一ページで遷移」決定の帰結。1セット3〜5分なので実害は小さいと判断した。localStorage への中間保存は行わない
- **localStorage のスキーマ変更時は履歴が消える。** 変換チェーンを書かない判断（§9-4）。ユーザーが本人1名・提出まで数日という前提に依存している
- **テンポ閾値 8/5/3秒は未検証の暫定値。** 実機で触って調整するまで、この数字に根拠はない
- **AI応答の文章品質はテストできない。** テストするのは「何を渡しているか」（プロンプト組み立て関数）と「返ってきたものの構造」（検証層）まで
- **`claude-sonnet-5` の実際のレイテンシは未測定。** 出力が長め（review_cards 複数枚）なので、遅ければ Haiku 4.5 と実測比較して `AI_MODEL` で切り替える
- 本仕様書の配布データに関する数値はすべて 2026-08-16 に `src/data/wordlist.json` を実測した値。再測定手順は `docs/data-findings.md` に残す
