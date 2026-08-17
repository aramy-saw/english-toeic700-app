/**
 * ★プロンプト本文の正典。Route Handler はこの関数を呼ぶだけにする。
 *
 * 純関数として保つ：Date.now() も Math.random() も呼ばない。
 * LLM の出力はテストできないが「何を渡しているか」はテストできる、が設計の前提。
 */
import { CAUSE_LABEL, causeLabel } from "../diagnosis";
import type { Cause, FeedbackRequest, Level, WordId } from "../types";

/**
 * ★2026-08-18 に上限を撤廃した（docs/spec.md §10-10）。
 *   5枚で切ると、今回まちがえた語の一部に必ず説明が入らない
 *   （＝「まだ説明がありません」のカードが残り続ける）。
 *   枚数を絞っていた理由は待機時間だったが、それはストリーミングで解いた（§12-6 d）。
 *   1枚ずつ届いた順に表示されるので、総数が増えても最初の1枚までの時間は変わらない。
 */

/** 1枚のカードを作らせる対象 */
export type CardTarget = {
  id: WordId;
  word: string;
  pos: string;
  level: Level;
  meaning: string;
  similar: string[];
  example_scene: string;
  cause: Cause;
  /** 由来。プロンプトで文脈を出し分けるために持つ */
  source: "pending" | "wrong" | "hesitant";
};

/**
 * docs/spec.md §10-10 の優先順位で対象を選ぶ。**上限は設けない。**
 *   1. 今回の誤答  2. 今回の非即答正解  3. pending
 *
 * ★2026-08-18 に順序を反転し、上限を撤廃した。
 *   従来は pending が先頭かつ5枚上限だったため、バックログがあると
 *   **今回作ったカードに今回の説明が1枚も入らなかった**（実測で確認）。
 *   「今回まちがえたことは、今回のうちに説明する」を優先する。
 *

 * ★req.pending は createdAt 昇順でソート済みである前提（§10-2 のコメント）。
 *   ここでは並べ替えず、配列順をそのまま信頼する。
 */
export function selectCardTargets(req: FeedbackRequest): CardTarget[] {
  const out: CardTarget[] = [];
  const taken = new Set<WordId>();

  const push = (t: CardTarget) => {
    // 上限なし（2026-08-18）。重複だけを弾く
    if (taken.has(t.id)) return;
    taken.add(t.id);
    out.push(t);
  };

  // 復習対象は cause が確定している語のみ（即答正解は cause === null で対象外）
  const fromResults = (source: "wrong" | "hesitant") => {
    for (const r of req.results) {
      if (r.cause === null) continue;
      const isWrong = !r.is_correct;
      if (source === "wrong" && !isWrong) continue;
      if (source === "hesitant" && isWrong) continue;
      push({
        id: r.id,
        word: r.word,
        pos: r.pos,
        level: r.level,
        meaning: r.meaning,
        similar: r.similar,
        example_scene: r.example_scene,
        cause: r.cause,
        source,
      });
    }
  };

  // 1. 今回の誤答
  fromResults("wrong");
  // 2. 今回の非即答正解
  fromResults("hesitant");

  // 3. pending（配列順＝createdAt 昇順を信頼する）。今回の対象で埋まっていれば入らない
  for (const p of req.pending) {
    push({
      id: p.id,
      word: p.word,
      pos: p.pos,
      level: p.level,
      meaning: p.meaning,
      similar: p.similar,
      example_scene: p.example_scene,
      cause: p.cause,
      source: "pending",
    });
  }

  return out;
}

const SOURCE_NOTE: Readonly<Record<CardTarget["source"], string>> = {
  pending: "前回までに説明を作れなかった語",
  wrong: "今回まちがえた語",
  hesitant: "今回は正解したが、即答できなかった語",
};

const formatTarget = (t: CardTarget, i: number): string =>
  [
    `${i + 1}. id=${t.id} / ${t.word}`,
    `   品詞: ${t.pos}`,
    `   レベル: L${t.level}`,
    `   意味: ${t.meaning}`,
    `   類義語: ${t.similar.join(", ")}`,
    `   使用場面: ${t.example_scene}`,
    // ★内部値（pos_mismatch 等）を渡さない。渡すと生成文にそのまま漏れる
    //   （2026-08-17 実機で pattern_summary に "(hesitant)" が出た）
    `   確定した原因: ${causeLabel(t.cause)}`,
    `   区分: ${SOURCE_NOTE[t.source]}`,
  ].join("\n");

/**
 * ミリ秒 → 秒の表示用文字列（docs/data-findings.md §9）。
 *
 * ★ms はアプリの内部表現であって、鈴木さんが読む単位ではない。
 *   2026-08-17 のモデル比較で、Sonnet 5 の explanation に
 *   「閾値の5000ms」がそのまま出た。cause の内部値を排除したのと同じ趣旨。
 *
 * 5000 → "5秒" / 4500 → "4.5秒"。小数1桁までで、末尾の .0 は作らない。
 */
function secondsLabel(ms: number): string {
  const sec = Math.round(ms / 100) / 10;
  return `${sec}秒`;
}

/** プロンプト本文を組み立てる。★ここが正典 */
export function buildFeedbackPrompt(req: FeedbackRequest): string {
  const s = req.session;
  const targets = selectCardTargets(req);
  const c = s.causeCounts;

  return `あなたはTOEIC指導の経験が長い講師です。EduBridge社の教育ノウハウを背景に持っています。

# 相手
32歳・会社員の鈴木さん。学習時間は通勤30分と昼休み15分だけ。
過去に英単語アプリを試したが3日で挫折した経験があります。

# あなたの役割
原因の「分析」はしません。**原因はアプリ側ですでに確定しています。**
あなたの仕事は、確定した原因を鈴木さんの言葉で説明することです。

# 口調
励ましすぎない。事実を淡々と、しかし具体的に。

# 禁止事項
1. 原因の推測・言い換え。渡された原因は確定した事実として扱い、覆したり別の原因を提示したりしない
2. 汎用的な励まし（「頑張りましょう」「その調子です」など）
3. 学習法の一般論（「毎日続けることが大切」など）
4. 語数・時間・スコアの創作。渡された数値以外は書かない
5. 内部の識別子をそのまま書くこと。
   \`pos_mismatch\` \`weak_memory\` \`hesitant\` のような英語の値を出力に含めない
   （括弧書きの補足としても書かない）
6. 時間をミリ秒で書くこと。時間に触れるときは「5秒」のように秒で書く。
   \`ms\` \`ミリ秒\` という単位を出力に含めない

# 今回のセッション結果（アプリが集計済み。数え直さないこと）
- テンポ設定: ${s.tempoLabel}（即答とみなす閾値: ${secondsLabel(s.instantThresholdMs)}）
- 出題数: ${s.questionCount}問
- スコア: ${s.score} / ${s.maxScore}
- 正解率: ${s.accuracyRate}
- 即答率: ${s.instantRate}
- 原因の内訳:
  - ${CAUSE_LABEL.pos_mismatch}: ${c.pos_mismatch}件
  - ${CAUSE_LABEL.weak_memory}: ${c.weak_memory}件
  - ${CAUSE_LABEL.hesitant}: ${c.hesitant}件

# 復習カードを作る対象（${targets.length}件）
以下の語だけを対象にしてください。**${targets.length}件すべてについて1枚ずつ作ってください。**
ここに無い語を返してはいけません。

${targets.map(formatTarget).join("\n\n")}

# 出力
指定のJSONスキーマに従って出力してください。

- pattern_summary: 今日の傾向を1〜2文。個々の語ではなく、${s.questionCount}問全体を見たパターンを述べる。
  **件数・割合・点数などの数値には一切触れない。** 数字はアプリが画面に出しているので、
  ここで繰り返す必要はない。「どういう傾向が出ているか」だけを言葉で述べる
- review_cards: 上の対象それぞれについて1枚。id と word は渡された値をそのまま返す
  - explanation: **その語で具体的にどうつまずいたか**を書く。
    **原因の名前を書かない。** 原因はアプリが画面に表示しているので、ここで繰り返す必要はない。
    確定した原因は説明の前提として使い、名前としては出さない
  - usage_note: 類義語との使い分けの説明
  - example_en: 使用場面に沿ったビジネス文脈の英文を1つ
  - example_ja: example_en の和訳
- next_message: 次回への一言
- suggested_tempo: 次回のテンポ設定の提案。以下に当てはまるときだけ変更を提案する
  - 現在が はやい 以外で、即答率が0.8以上かつ正解率が0.8以上 → "fast"
  - 現在が ゆっくり 以外で、正解率が0.5以下 → "slow"
  - 現在が ふつう 以外で、上記に当たらず現在のテンポが明らかに合っていない → "normal"
  - 上記のいずれにも当たらない → "none"
`;
}
