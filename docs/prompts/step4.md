# STEP 4 — AI連携（フィードバック機能）

このファイルは STEP 4 の作業指示です。
着手前に必ず全文を読んでください。

正典は `docs/spec.md` です。このファイルと spec.md が食い違った場合、
spec.md が正しいものとして扱い、**食い違いを最優先で報告してください**。

---

## 0. STEP 4 の位置づけ

卒業要件は「Claude API を使ったフィードバック機能が1つ以上」です。
spec.md §10 のセッション終了後フィードバックが、その1つです。
**これ以外の AI 機能は追加しません。** spec.md に無い機能を作らないでください。

STEP 3 で作った9モジュールは純関数として完成しています。
STEP 4 はその上に「AI に投げる層」と「AI の応答を検証する層」を足します。

---

## 1. 前提の確認（着手前に読むもの）

以下を読んでから着手してください。

| ファイル | 読む箇所 |
|---|---|
| `docs/spec.md` | §10 全体（§10-1 〜 §10-10） |
| `docs/spec.md` | §9-2（CardContent の型） |
| `src/lib/types.ts` | 既存のドメイン型 |
| `src/lib/diagnosis.ts` | Cause の扱い |
| `src/lib/reviewCards.ts` | CardMap の扱い |
| `CLAUDE.md` | テストのルール（全文） |

読んだうえで、spec.md と実装が食い違っている箇所があれば先に報告してください。

---

## 2. 保留2件の決定（2026-08-16）

STEP 3 完了時に保留していた2件を確定します。

### 2-1. cause_label のマッピング関数は `src/lib/diagnosis.ts` に置く

理由：`diagnosis.ts` が `Cause` 型のドメインを所有しているモジュールだから。
ラベルは Cause の表示面であり、別モジュールに切り出すと
「Cause を扱う場所」が2箇所に散る。

```ts
// src/lib/diagnosis.ts に追記
export const CAUSE_LABEL: Readonly<Record<Cause, string>> = {
  pos_mismatch: "品詞の取り違え",
  weak_memory: "意味の記憶があいまい",
  hesitant: "思い出すのに時間がかかった",
};
export function causeLabel(cause: Cause): string;
```

### 2-2. `slice(0, 5)` は `src/lib/aiResponse.ts` に置く

理由：純関数としてテストできる層に置きたい。
Route Handler は薄く保ち、ロジックを持たせない。
プロンプト本文での「最大5枚」指示と合わせて二重担保になる。

---

## 3. 作るファイル

### 新規

| ファイル | 責務 |
|---|---|
| `src/lib/prompts/schema.ts` | 出力 JSON Schema（spec.md §10-3 の転記） |
| `src/lib/prompts/feedback.ts` | **プロンプト本文の正典**。組み立ての純関数 |
| `src/lib/aiResponse.ts` | AI応答の検証（V1〜V5）・枚数制御・CardMap への反映 |
| `src/app/api/feedback/route.ts` | Route Handler。Claude API を叩く |
| `src/platform/feedbackClient.ts` | クライアント側の fetch。AbortController 25秒 |
| `docs/prompt-design.md` | 設計判断の記録（**本文は複製しない**） |

### 追記

| ファイル | 追記内容 |
|---|---|
| `src/lib/types.ts` | `FeedbackRequest` / `FeedbackResponse` / `AiReviewCard` |
| `src/lib/diagnosis.ts` | `CAUSE_LABEL` / `causeLabel()` |

### 触らないもの

`src/lib/` の既存9モジュール（types.ts / diagnosis.ts を除く）は変更しないでください。
STEP 3 のテスト42件が赤に戻ったら、そこで止まって報告してください。

---

## 4. src/lib/ と src/platform/ と app/api/ の責務分担

| | src/lib/ | src/platform/ | src/app/api/ |
|---|---|---|---|
| 触ってよい | 純粋な TypeScript のみ | fetch / AbortController | process.env / Anthropic SDK |
| 時刻 | 引数 `now: number` で受ける | `Date.now()` | — |
| ネットワーク | しない | クライアント→自サーバー | サーバー→Claude API |
| テスト | 純関数として全部テストする | しない（実測で確認） | しない（実測で確認） |

**プロンプト本文は `src/lib/prompts/feedback.ts` が正典です。**
Route Handler は feedback.ts の関数を呼んで組み立てるだけにしてください。
本文を route.ts 側に書かないでください。

---

## 5. 関数シグネチャ（提案。着手前に提示して承認を得ること）

以下は方向性の提示です。**実際のシグネチャは spec.md を読んだうえで
あなたが提案し、私の承認を得てから実装してください。**

### types.ts への追記

`FeedbackRequest` は spec.md §10-2（500〜543行）にそのまま定義があります。
転記してください。推測で変えないでください。

`FeedbackResponse` という型名は spec.md に存在しません。
§10-3 の JSON Schema から型を起こし、その旨をコメントで明記してください。

### prompts/schema.ts

```ts
export const RESPONSE_SCHEMA: object;  // spec.md §10-3 の転記
```

`maxLength` / `minLength` / `maxItems` / `minimum` / `maximum` は
**使えません**（spec.md §10-1）。`enum` と `anyOf` は使えます。
枚数と文字数はプロンプト本文で指示します。

### prompts/feedback.ts

```ts
export type CardTarget = { /* 1枚のカードを作らせる対象 */ };

/** spec.md §10-10 の優先順位で対象を選び、最大5件に絞る */
export function selectCardTargets(req: FeedbackRequest): CardTarget[];

/** プロンプト本文を組み立てる。★ここが正典 */
export function buildFeedbackPrompt(req: FeedbackRequest): string;
```

`buildFeedbackPrompt` は文字列を返す純関数にしてください。
`Date.now()` も `Math.random()` も呼ばないでください。

### aiResponse.ts

```ts
export type ValidationResult =
  | { ok: true; response: FeedbackResponse }
  | { ok: false; reason: string };

/** spec.md §10-5 の V1〜V5 */
export function validateAiResponse(
  raw: unknown,
  presentedIds: readonly WordId[],
  byId: ReadonlyMap<WordId, WordEntry>
): ValidationResult;

/** 検証済みレスポンスを CardMap に反映する。cause_label はここで埋める */
export function applyAiResponseToCards(
  cards: CardMap,
  response: FeedbackResponse,
  now: number
): CardMap;
```

---

## 6. テストの境界（★ここが STEP 4 の肝）

CLAUDE.md に書いたとおりです。**LLM の出力の中身はテストしません。**
出力をアサートすると点滅するテストが生まれ、それを避けようと緩い判定を書くと
「アサーションを緩める」に抵触します。最初から境界を引きます。

### テストする（＝入力と検証）

| 対象 | 何を確認するか |
|---|---|
| `causeLabel()` | 3つの Cause それぞれが固定文言を返す |
| `selectCardTargets()` | 優先順位（pending → 誤答 → 非即答正解） |
| `selectCardTargets()` | 上限5件。6件以上の候補があっても5件 |
| `selectCardTargets()` | pending が5件あるとき、今回の誤答は入らない |
| `buildFeedbackPrompt()` | 禁止事項の文言が含まれる |
| `buildFeedbackPrompt()` | causeCounts が含まれる（AIに数えさせない） |
| `buildFeedbackPrompt()` | 対象語の similar が含まれる |
| `buildFeedbackPrompt()` | 対象語の example_scene が含まれる |
| `buildFeedbackPrompt()` | 「最大5枚」の指示が含まれる |
| `buildFeedbackPrompt()` | **渡さないものが含まれない**（spec.md §10-2 546行） |
| `RESPONSE_SCHEMA` | 非対応キーワードを含まない |
| `RESPONSE_SCHEMA` | cause_label を含まない（2026-08-16 の決定） |
| `validateAiResponse()` | V1：パース不能・スキーマ形状違反 → 全体エラー |
| `validateAiResponse()` | V2：presented に無い id → 全体エラー |
| `validateAiResponse()` | V2：word が byId と不一致 → 全体エラー |
| `validateAiResponse()` | V3：復習対象が全部揃っていなくても ok |
| `validateAiResponse()` | 6枚返ってきたら5枚に切る |
| `applyAiResponseToCards()` | cause_label がアプリ側の固定文言で入る |
| `applyAiResponseToCards()` | state が "ready" になる |
| `applyAiResponseToCards()` | 対象外のカードは pending のまま残る |

「渡さないものが含まれない」は特に重要です。
日付・localStorage 全体・セッション履歴・個人情報が
プロンプトに混入していないことを、実際の文字列で確認してください。

### テストしない

- LLM が返した文章の中身（explanation の妥当性、例文の品質）
- レイテンシ
- AbortController の 25秒タイムアウト（実測で確認する）

---

## 7. 進め方

STEP 3 と同じです。**テストを先に書き、赤いことを確認してから実装します。**

### 段階

| 段階 | 内容 |
|---|---|
| 1 | `types.ts` 追記 + `diagnosis.ts` に causeLabel |
| 2 | `prompts/schema.ts` |
| 3 | `prompts/feedback.ts` |
| 4 | `aiResponse.ts` |
| 5 | `app/api/feedback/route.ts` |
| 6 | `platform/feedbackClient.ts` |
| 7 | `docs/prompt-design.md` |

段階1〜4は純関数なので、テスト先行で進めます。
段階5〜6は環境が絡むため、実際に叩いて確認します。

### 各段階の報告に必ず含めること

- green になったテスト名（件数だけでなく名前）
- なぜ green になったかの説明（1〜2行）
- まだ赤いテストの件数

「なぜ緑になったか説明できない緑」が1件でもあれば、
次の段階に進まず報告して止まってください。

### 止まる条件

以下のいずれかが起きたら、必ず止まって報告してください。

- テストの期待値を変えたくなったとき
- spec.md と実装が食い違ったとき
- 一度 green になったテストが赤に戻ったとき（STEP 3 の42件を含む）
- 段階4より先に進むとき（環境が絡むため、一度承認を取る）

### コミット

段階1〜4が全部 green になった時点で一度報告してください。
コミットの是非はそこで判断します。途中でコミットしないでください。

---

## 8. 環境まわり

### 依存の追加

`@anthropic-ai/sdk` が未導入です。段階5の前に入れてください。
入れる前に、インストールするコマンドを提示して承認を得てください。

### 環境変数

| 変数 | 用途 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API のキー |
| `AI_MODEL` | 未設定時は `claude-sonnet-5`（spec.md §10 636行） |

`.env.local` に書きます。**`.env.local` はコミットしないでください。**
`.gitignore` の `.env*` で無視されることは確認済みです。

キーの値をターミナルに出力しないでください。
確認が必要な場合は `grep -c` で件数だけ数えてください。

### API キー未設定時の挙動

500 を返さず、「pending 方式に落とす」レスポンスを返します（spec.md §10 638行）。
つまり **キーが無くてもアプリは動きます**。カードは pending のまま作られます。

これは段階5のテスト方法としても使えます。
キーを設定する前に、未設定時の経路が正しく動くことを先に確認してください。

---

## 9. AI の役割（プロンプトを書くときの最重要事項）

spec.md §10-8 に転記済みですが、ここでも繰り返します。

> **AI に原因を「分析」させない。cause はアプリ側で確定済み。
> AI の役割は「確定した原因を、鈴木さんの言葉で説明する」こと。**

- 役割：TOEIC指導の経験が長い講師。EduBridge社の教育ノウハウを背景に持つ
- 相手：32歳会社員の鈴木さん。通勤30分＋昼休み15分。過去に3日で挫折
- 口調：励ましすぎない。事実を淡々と、しかし具体的に
- 禁止：「頑張りましょう」のような汎用的な励まし。一般論

普通の実装は原因推定まで AI に丸投げするので一般論が返ってきます。
このアプリは原因を先に確定させるので、必然的に個別化されます。
**この設計がこのアプリの唯一の売りです。プロンプトでそれを壊さないでください。**

---

## 10. docs/prompt-design.md について

STEP 4 の成果物です。ただし**プロンプト本文を複製しないでください。**
本文の正典は `src/lib/prompts/feedback.ts` です。

prompt-design.md に書くのは設計判断だけです。

- なぜ cause をアプリ側で確定させてから渡すのか
- なぜ causeCounts を渡すのか（AI に数えさせない）
- なぜ cause_label をスキーマから外したのか
- なぜ出力を5枚に絞ったのか
- なぜ structured outputs を使うのか
- 渡さないものと、その理由

本文が知りたい人は feedback.ts を読む、という構造にしてください。

---

## 11. 最初にやること

1. §1 のファイルを読む
2. spec.md と食い違う点があれば報告する
3. 作るファイル一覧と関数シグネチャを提示する
4. テストケース一覧を提示する（§6 を土台に、必要なら増やす）
5. **そこで止まる**

承認後に、テストを先に書く → 赤いことを確認 → 段階1の実装、と進みます。

推測で決めないでください。実物を読んでから提示してください。
書かれていないことは「書かれていない」と報告してください。埋めないでください。
