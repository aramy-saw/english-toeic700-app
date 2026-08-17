# STEP 6：UI実装

作成日：2026-08-16
配置先：`docs/prompts/step6.md`
前提：STEP 5 完了（`c624ffb` / `b2b36ea`）。作業ツリーはクリーン。

---

## §0. 現在地

| 項目 | 状態 |
|---|---|
| STEP 1〜5 | 完了 |
| テスト | 68件 green / 0 red |
| `tsc --noEmit` / `lint` / `build` | いずれも exit 0 |
| 本番デプロイ | 済（実API疎通確認済み） |
| `src/app/page.tsx` | **create-next-app の初期状態のまま** |
| `src/app/globals.css` | **create-next-app の初期状態のまま**（`prefers-color-scheme` あり） |
| `src/components/` | **存在しない** |
| `src/platform/` | `feedbackClient.ts` のみ |

つまり **画面はまだ1枚も無い**。STEP 6 でアプリとして動く状態にする。

---

## §1. 位置づけ

### この STEP ですること

STEP 5 で確定した設計（`spec.md` §12〜13）を、**そのままコードにする**。

### この STEP でしないこと

- 設計を決め直すこと（`spec.md` が正典。食い違いを見つけたら止まって報告する）
- 新しい機能を足すこと
- 見た目のテストを書くこと（§6 参照）
- 新しい依存パッケージを入れること
- `src/data/wordlist.json` に触れること（**絶対に書き換えない**）
- `layout.tsx` の `title` / `description` / `lang` を直すこと（STEP 7 の作業）

---

## §2. 着手前に読むファイル

1. `docs/spec.md` §12（画面設計）と §13（デザイン設計）— **全文**
2. `docs/decisions.md` の STEP 5 節
3. `CLAUDE.md`（テストのルール4件を必ず守る）
4. `src/lib/` 配下の既存モジュール（型とシグネチャを**実物で**確認する。推測で書かない）

---

## §3. 事前に確定した判断

**この STEP では新しい判断をしない。**以下はすべて確定済みとして扱う。
迷いが生じたら実装せず、§8 に従って止まる。

| # | 判断 | 内容 |
|---|---|---|
| 1 | `/review` 画面の操作 | **読むだけ**。カードの削除・編集・タップ操作を作らない（§13-1「静かな道具」） |
| 2 | §12-6 c の実装方式 | **破棄**。「もう1セット」を押した時点で前セットの AI 応答は捨てる。`useRef` での生存は作らない |
| 3 | 待機中のカード見出し表示 | **出さない**。カードは5枚同時到着（§12-6 d・e） |
| 4 | 16px 下限 | **緩めない**。13〜14px のキャプションを作らない（§13-6 b） |
| 5 | 画面遷移の持ち方 | `page.tsx` が `home` / `quiz` / `analyzing` / `result` を **state** で持つ。`/review` のみ別ルート。※ `spec.md` §12 に別の記述があれば **spec.md が優先**。その場合は止まって報告する |
| 6 | CSS の書き方 | `globals.css` に CSS 変数を定義し、Tailwind のユーティリティと併用する。CSS-in-JS やモジュール CSS を新規導入しない |

---

## §4. 作るファイル一覧

```
src/app/globals.css          （既存を書き換え。トークン定義・暗色固定）
src/app/layout.tsx           （既存を編集。Geist / Geist_Mono を外すのみ）
src/app/page.tsx             （既存を全面書き換え。home / quiz / analyzing / result）
src/app/review/page.tsx      （新規。復習カード一覧・読むだけ）

src/platform/storage.ts      （新規。localStorage の読み書きとバージョン検査）
src/platform/clock.ts        （新規。Date.now() / todayJst()）
src/platform/rng.ts          （新規。Math.random のラッパ）

src/components/AppBar.tsx      上部バー
src/components/Dock.tsx        下端固定の操作領域
src/components/ScoreStrip.tsx  ★署名要素
src/components/Readout.tsx     左ラベル＋右数値の1行
src/components/CauseTable.tsx  原因の内訳3行
src/components/ChoiceButton.tsx 4択
src/components/ReviewCard.tsx  復習カード
src/components/AiSlot.tsx      AI由来領域の予約枠

src/platform/storage.test.ts
src/platform/clock.test.ts
src/platform/rng.test.ts
```

コンポーネントの責務は `spec.md` §13-8 の表に従う。表に無い部品を勝手に足さない。

---

## §5. 段階分け

**6段階。各段階の終わりで必ず止まり、完了報告をしてから次に進む。**
段階をまたいで一気に進めない。各段階は独立して revert できる状態にする。

### 段階0：土台（ネットワーク不要）

**目的**：デザイントークンを実体化し、初期状態の残骸を消す。

触るファイル：`src/app/globals.css` / `src/app/layout.tsx`

- `spec.md` §13-5 の色9トークン・余白8段・角丸2種を `:root` に転記する
- `--font-ja` / `--font-en`（§13-6 a）を定義する
- `prefers-color-scheme` の分岐を**外して暗色固定**にする
- コンテンツ幅：最大 `480px` で中央寄せ、画面左右余白 `20px` 固定
- `layout.tsx` から `Geist` / `Geist_Mono` の import と適用を**外す**（§13-6 d）
- `title` / `description` / `lang` は**触らない**（STEP 7）

完了条件：`npm run build` が exit 0。画面は初期状態のままでよい。

---

### 段階1：platform 3本（ネットワーク不要）

**目的**：副作用を1箇所に閉じ込める。ここだけテストを書く。

触るファイル：`src/platform/storage.ts` / `clock.ts` / `rng.ts` ＋ 各 `.test.ts`

- `storage.ts`：保存データにバージョン番号を持たせる。**バージョンが一致しないときは読まずに初期値を返す**（壊れた JSON でも落ちない）
- `clock.ts`：`now()` と `todayJst()`。JST の日付境界を跨ぐ扱いをテストする
- `rng.ts`：`Math.random` のラッパ。`shuffle.ts` が RNG を引数で受ける設計（STEP 3）に合わせる

**テストで確認すること**

| ファイル | 確認する挙動 |
|---|---|
| storage | 保存→読込で往復する / バージョン不一致なら初期値 / 壊れた JSON でも例外を投げずに初期値 / キーが無いときの初期値 |
| clock | `todayJst()` が JST の日付を返す / UTC 深夜が JST では翌日になる |
| rng | 注入した固定関数がそのまま使われる / 範囲が [0,1) に収まる |

**テストファイルのトップレベルで重い初期化を呼ばない**（STEP 3 の教訓。テスト名が消える）。

完了条件：テストが **68 + 新規** 件で全 green。`tsc` / `lint` / `build` が exit 0。

---

### 段階2：ScoreStrip 単体（ネットワーク不要）★最重要

**目的**：3画面で使い回す署名要素の見え方を、**実物で確認してから**先に進む。
ここの見え方が違うと後の3段階が全部やり直しになるため、単体で先に作る。

触るファイル：`src/components/ScoreStrip.tsx` / `src/app/page.tsx`（確認用に一時的に表示）

`spec.md` §13-8 の仕様どおりに作る：

| 結果 | 高さ | 色 | 得点 |
|---|---|---|---|
| 即答正解 | 全高（20px） | `--ok` | 10 |
| 正解（即答でない） | 半分（10px） | `--attn` | 5 |
| 誤答・無回答 | 下端の残り（3px） | `--attn` | 0 |
| 未回答（`quiz` 中） | 枠のみ | `--line` | — |

- 本数 = `QUESTIONS_PER_SESSION`（10）。幅は均等割。間隔 4px、角丸 `--r1`
- 凡例は**常に文字で出す**（§13-9）。「高＝即答正解10 ／ 半＝正解(迷い)5 ／ ＿＝誤答0」
- `quiz` の進捗にも同じ部品を使う。**進捗バーを別に作らない**

**確認**：`page.tsx` に代表的な3パターン（全問即答正解 / 混在 / quiz 途中）を並べて表示し、スマホの実機で見る。等幅の桁揃え・緑と橙の高さ差・4px の間隔が成立しているか。

完了条件：実機で確認が取れた旨を報告。`build` が exit 0。

---

### 段階3：出題画面（ネットワーク不要）

触るファイル：`src/components/AppBar.tsx` / `Dock.tsx` / `ChoiceButton.tsx` / `src/app/page.tsx`

- 上部バー 48px・下辺に 1px（`--line`）。左＝`ENGLISH700`（等幅）／右＝`3 / 10`
- 出題語は `clamp(26px, 8vw, 34px)` の等幅。品詞は 16px `--text-sub`
- 4択は縦積み。各 56px、間隔 8px。ドックの直上に置く（§12-7「主要な操作と4択は下寄せ」）
- 「わからない」「やめる」はテキストボタン
- 回答後：選択肢の左に「正解」「選択」の**文字**を出す（§13-9。色だけに頼らない）。ドックを「次へ」に差し替える
- 押下のモーションは背景色 120ms のみ（§13-10 a）
- 回答時間を計測し、`tempo.ts` の閾値（slow 8000 / normal 5000 / fast 3000）に渡す

完了条件：10問を最後まで通せる。テスト全 green。`tsc` / `lint` / `build` が exit 0。

---

### 段階4：結果画面（**ここで初めて実APIを叩く**）

触るファイル：`src/components/Readout.tsx` / `CauseTable.tsx` / `AiSlot.tsx` / `ReviewCard.tsx` / `src/app/page.tsx`

- `analyzing` と `result` は**同一レイアウトの状態差**。画面を切り替えない（§12-6 a）
- 上から：SCORE（56px 等幅）→ ScoreStrip → 正解率・即答率 → 原因の内訳 → **区切り線** → ここから下が AI 由来（§13-7 b）
- `CauseTable` は **0件でも行を消さず `0` と出す**（3種類あることを毎回見せる）
- `pattern_summary` の枠だけ 2行分の `min-height` を予約する。`review_cards` は最下部なので予約しない
- 待機中の文言は `分析中…` の1つだけ。**スピナーを置かない**（§12-6 e）
- カード到着：`opacity 0→1` ＋ `translateY 6px→0` ／ 240ms ／ ease-out ／ **0.1秒間隔で1枚ずつ**
- `prefers-reduced-motion: reduce` のとき：遅延と移動を無効化し、カードは即座に表示（不透明度も遷移させない）
- AI 到着前でも「もう1セット」を押せる。押した時点で前セットの応答は**捨てる**（§3 の判断2）
- 失敗時は1行のみ。謝罪しない・再取得ボタンを置かない
- タイムアウトは `FEEDBACK_TIMEOUT_MS = 45000`

**実API を叩く前に、通信が安定していることを確認する。** 1リクエスト約25秒かかる。

完了条件：1セット通して実APIからカードが5枚届く。テスト全 green。`tsc` / `lint` / `build` が exit 0。

---

### 段階5：ホーム画面と `/review`

触るファイル：`src/app/page.tsx`（home 状態）／`src/app/review/page.tsx`

**ホーム**
- タグライン「なぜ間違えたかが、わかる。」（26px）
- 前回 SCORE ＋ ScoreStrip（前回セット）／正解率・即答率
- 復習カード枚数 → `/review` へのリンク
- テンポ設定3択。**色だけでなく文字でも現在値を出す**（「現在：ふつう」）
- 「はじめる」大ボタン（52px・幅100%）

**`/review`**
- 見出しは `word — meaning 先頭`（§11 の重複語対策そのまま）
- `pending` を上・`missCount` 降順
- `ready` は「説明あり」、`pending` は「説明は次回のセッションで追加されます」（§13-9）
  ※2026-08-18 に「まだ説明がありません」へ変更（spec.md §10-6）
- **読むだけ。操作を作らない**
  ※2026-08-18 にカードの手動削除を追加（spec.md §12-8）。この判断は撤回された

完了条件：ホーム → 出題 → 結果 → ホーム が一周する。`/review` が開く。テスト全 green。`tsc` / `lint` / `build` が exit 0。

---

## §6. テストの方針

**テストする**：`src/platform/` の3本のみ。

**テストしない**：見た目、アニメーション、React コンポーネントの描画。

理由：STEP 3・4 で確立した「出力はテストしない、入力はテストする」の延長。
UI のテストを書き始めると STEP 6 が2倍に膨らみ、締切に間に合わない。
見た目の確認は**実機の目視**で行う（段階2・5）。

`CLAUDE.md` のテストルール4件を必ず守る：

1. 失敗のまま次へ進まない
2. 理解しないまま直さない（原因と修正方針を先に提示する）
3. 回さずに完了と言わない（完了報告に件数・green/red・tsc・lint・build を必ず含める）
4. テスト側を曲げない（アサーション緩和・`skip`・`only` を使わない）

---

## §7. 発動するスラッシュコマンド

**段階2の着手直前に `/frontend-design` を実行する。**

STEP 5 では「方針を決める」ために使った。今回は「決まった方針をコードにする」ために使う。
`spec.md` §13-5〜13-10 が入力であり、ここで方針を決め直さない。

飛ばさない。

---

## §8. 止まる条件

以下に該当したら、**実装せずに止まって報告する**。

1. **各段階の終わり**（例外なく毎回止まる）
2. `spec.md` と食い違いを見つけたとき（`spec.md` が正典。勝手に直さない）
3. 新しい判断が必要になったとき（§3 に無い判断は**しない**）
4. テストが赤になったとき
5. 新しい依存パッケージを入れたくなったとき
6. `src/data/wordlist.json` に触れる必要が出たとき（**触らない**。設計が間違っている）
7. `src/lib/` の既存モジュールを変更する必要が出たとき（STEP 3 の成果物。変更は要判断）
8. 通信が切れて実APIが叩けないとき（段階4）

---

## §9. 完了条件

- [ ] 段階0〜5 がすべて完了している
- [ ] テストが **68 + 新規** 件で全 green / 0 red
- [ ] `npx tsc --noEmit` exit 0
- [ ] `npm run lint` exit 0
- [ ] `npm run build` exit 0
- [ ] ホーム → 出題 → 結果 → ホーム が一周する
- [ ] `/review` が開く
- [ ] 実機（スマホ）で ScoreStrip と日英混在の見え方を確認した
- [ ] 段階ごとにコミットが分かれている

---

## §10. 運用上の注意（船上作業）

**この STEP は移動中に進める。判断を求めない設計にしてある。**

- 承認は **「1. Yes」のみ**。「2. don't ask again」は選ばない
- `manual mode`（`shift+tab`）を維持する。`auto-mode` は有効にしない
- **各段階の終わりで必ずコミットする。** 通信が切れても段階の頭から再開できる状態にする
- 段階0〜3 はネットワーク不要（AI 呼び出しなし）。**電波が不安定なら段階3まで進めて段階4は陸に戻ってから**
- 実機確認（段階2・5）は、PC とスマホを同じネットワークに繋いで `localhost` を開く
- 判断が必要になったら、**実装せずに止めて次の機会に回す**。判断を伴う実装を独断で進めない

---

## §11. 完了後の書き戻し

- `docs/進捗管理.md`：STEP 6 のチェックボックスを更新。品質チェックの記録に1行追加。「最終更新」日付を更新
- `docs/decisions.md`：STEP 6 で確定したことがあれば索引を追加（§3 の事前確定分は STEP 5 側に記録済み）
- `docs/spec.md`：**設計を変えていない限り触らない**

---

## §12. 次の STEP

STEP 7：デプロイ・本番確認 → `layout.tsx` の `title` / `description` / `lang` 修正 → README → OGP → `sk-ant-` の横断 grep → リポジトリの Private/Public 判断 → Commune へ投稿
