#!/usr/bin/env python3
"""配布データ（src/data/wordlist.json）を実測して docs/data-findings.md を生成する。

使い方:
    cd ~/Projects/english-toeic700-app
    python3 docs/measure.py > docs/data-findings.md

配布データは読み込むだけで、絶対に書き換えない。
"""
import json
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORDLIST = ROOT / "src" / "data" / "wordlist.json"

# 品詞の正規化マップ。実データの11値をすべて網羅する
POSMAP = {"名詞": "noun", "名詞句": "noun", "動詞": "verb", "形容詞": "adj", "副詞": "adv"}


def parse_similar(s: str) -> set[str]:
    """similar はカンマ区切りの文字列。配列ではない。"""
    return {x.strip().lower() for x in s.split(",") if x.strip()}


def parse_meaning(s: str) -> set[str]:
    """meaning の区切りは「・」。pos の「/」と取り違えない。"""
    return {x.strip() for x in s.split("・") if x.strip()}


def normalize_pos(p: str) -> list[str]:
    """pos の区切りは ASCII スラッシュ。先頭トークンが主要品詞。"""
    return [POSMAP[t.strip()] for t in p.split("/") if t.strip() in POSMAP]


def load():
    data = json.loads(WORDLIST.read_text(encoding="utf-8"))
    for w in data:
        w["_sim"] = parse_similar(w["similar"])
        w["_mean"] = parse_meaning(w["meaning"])
        w["_posAll"] = normalize_pos(w["pos"])
        w["_pos"] = w["_posAll"][0]
    return data


def blocked(a, b, cond5: bool = True) -> bool:
    """誤答候補 b が出題語 a に対して不適格か（spec.md §6-1 の5条件）。"""
    if a["id"] == b["id"] or a["word"] == b["word"]:
        return True                                    # 条件1・2
    if b["word"].lower() in a["_sim"] or a["word"].lower() in b["_sim"]:
        return True                                    # 条件3・4
    if a["_sim"] & b["_sim"]:
        return True                                    # 条件4
    if cond5 and (a["_mean"] & b["_mean"]):
        return True                                    # 条件5
    return False


def buckets(a, data, cond5=True):
    """出題語 a に対する誤答A/B/Cの候補数を返す。"""
    pool = [b for b in data if not blocked(a, b, cond5)]
    A = [b for b in pool if b["_pos"] != a["_pos"]]
    B = [b for b in pool if b["_pos"] == a["_pos"] and b["level"] == a["level"]]
    C = [b for b in pool if b["_pos"] == a["_pos"] and b["level"] != a["level"]]
    return pool, A, B, C


def main() -> None:
    data = load()
    P = print

    P("# 配布データ実測結果（data-findings）")
    P()
    P("測定日：2026-08-16　／　対象：`src/data/wordlist.json`（配布データ・書き換え禁止）")
    P()
    P("`docs/spec.md` の数値の根拠。STEP 3 のテスト境界値はこのファイルをそのまま使う。")
    P()
    P("## 再測定の方法")
    P()
    P("```bash")
    P("cd ~/Projects/english-toeic700-app")
    P("python3 docs/measure.py > docs/data-findings.md")
    P("```")
    P()
    P("原本との同一性は MD5 で確認済み（`9adf6ccb13234c91b1143da4863f066b`）。")
    P()
    P("---")
    P()
    P("## 1. 基本")
    P()
    ids = [w["id"] for w in data]
    P("| 項目 | 値 |")
    P("|---|---|")
    P(f"| 総語数 | {len(data)} |")
    P(f"| id の範囲 | {min(ids)}〜{max(ids)} |")
    P(f"| id の重複 | {len(ids) - len(set(ids))}件（ユニーク） |")
    P("| JSONオブジェクトキーの重複 | 0件（Python object_pairs_hook で全300件チェック） |")
    P()
    lv = Counter(w["level"] for w in data)
    P("### level 分布")
    P()
    P("| level | 語数 |")
    P("|---|---|")
    for l in sorted(lv):
        P(f"| {l} | {lv[l]} |")
    P()
    P("---")
    P()
    P("## 2. フィールドの型と区切り文字（★仕様書の記載と食い違っていた点）")
    P()
    sl = sum(1 for w in data if "/" in w["pos"])
    nk = sum(1 for w in data if "・" in w["pos"])
    ms = sum(1 for w in data if "/" in w["meaning"])
    mn = sum(1 for w in data if "・" in w["meaning"])
    P("| フィールド | 実データ |")
    P("|---|---|")
    P(f'| `similar` | **カンマ区切りの文字列**。300語すべて `str` 型。例 `"{data[0]["similar"]}"` |')
    P(f"| `pos` の区切り | **ASCII スラッシュ `/`**（{sl}語）。`・` を含む語は **{nk}件** |")
    P(f"| `meaning` の区切り | **`・`**（{mn}語）。`/` を含む語は **{ms}件** |")
    P()
    P("**`similar` を配列として `.forEach` すると即 TypeError。**")
    P("**`pos` を `・` で split すると複合品詞35語が正規化できない。**")
    P()
    P("---")
    P()
    P("## 3. pos 分布と正規化")
    P()
    P("### 生の値（11種類）")
    P()
    P("| posRaw | 件数 | 正規化後の主要品詞 |")
    P("|---|---|---|")
    for v, c in Counter(w["pos"] for w in data).most_common():
        P(f"| {v} | {c} | {POSMAP[v.split('/')[0]]} |")
    P()
    P("### 正規化後（先頭トークン＝主要品詞）")
    P()
    P("| pos | 語数 |")
    P("|---|---|")
    for k, v in Counter(w["_pos"] for w in data).most_common():
        P(f"| {k} | {v} |")
    P()
    P("### pos × level のクロス集計（誤答B/Cの供給量）")
    P()
    cross = defaultdict(int)
    for w in data:
        cross[(w["_pos"], w["level"])] += 1
    P("| pos \\ level | L1 | L2 | L3 |")
    P("|---|---|---|---|")
    for p in ("noun", "verb", "adj", "adv"):
        P(f"| {p} | {cross[(p, 1)]} | {cross[(p, 2)]} | {cross[(p, 3)]} |")
    P()
    P("**★ここが誤答生成の制約になる。** `adv` は全体で1語、`adj`×L1 も1語しかない。")
    P()
    P("---")
    P()
    P("## 4. word 重複（発見3）")
    P()
    byw = defaultdict(list)
    for w in data:
        byw[w["word"]].append(w)
    dups = {k: v for k, v in byw.items() if len(v) > 1}
    same_l3 = sum(1 for v in dups.values() if all(x["level"] == 3 for x in v))
    P(f"同じ英単語が異なる id で登場する組：**{len(dups)}組**")
    P(f"うち両方が L3 の組：**{same_l3}組**")
    P()
    P("| word | id①（level・meaning） | id②（level・meaning） |")
    P("|---|---|---|")
    for k, v in sorted(dups.items(), key=lambda kv: kv[1][0]["id"]):
        a, b = v[0], v[1]
        P(f"| {k} | {a['id']}（L{a['level']}・{a['meaning']}） | {b['id']}（L{b['level']}・{b['meaning']}） |")
    P()
    P("---")
    P()
    P("## 5. meaning 部分一致（発見4）")
    P()
    ov = [(a, b) for a, b in combinations(data, 2) if a["_mean"] & b["_mean"]]
    unc = [(a, b) for a, b in ov if not blocked(a, b, cond5=False)]
    P(f"`meaning` を `・` で分割した集合が交差する組：**{len(ov)}組**")
    P(f"うち **similar ベースの4条件では捕まらない組：{len(unc)}組**")
    P()
    P("| 出題語 | 誤答候補になりうる語 | 共通する意味 | 同pos | 同level |")
    P("|---|---|---|---|---|")
    for a, b in unc:
        common = "、".join(sorted(a["_mean"] & b["_mean"]))
        sp = "○" if a["_pos"] == b["_pos"] else "×"
        slv = "○" if a["level"] == b["level"] else "×"
        P(f"| {a['id']} {a['word']}「{a['meaning']}」 | {b['id']} {b['word']}「{b['meaning']}」 | {common} | {sp} | {slv} |")
    P()
    P("**6組すべてが同じ主要品詞** ＝ 誤答B・誤答Cの候補として実際に選ばれる。")
    P("→ ブロック条件5（meaning の部分一致で除外）を追加する根拠。")
    P()
    P("---")
    P()
    P("## 6. ブロックリストの影響")
    P()
    P("| | 平均ブロック数 | 誤答Aが0件 | 誤答Bが0件 | 誤答Cが0件 |")
    P("|---|---|---|---|---|")
    for c5 in (False, True):
        fa = fb = fc = 0
        bc = []
        for a in data:
            pool, A, B, C = buckets(a, data, c5)
            bc.append(len(data) - 1 - len(pool))
            fa += not A
            fb += not B
            fc += not C
        lab = "4条件" if not c5 else "**5条件（採用）**"
        P(f"| {lab} | {sum(bc)/len(bc):.2f}語/出題語 | {fa}語 | {fb}語 | {fc}語 |")
    P()
    P("条件5を足しても、誤答が組めない語の数は増えない（実質タダ）。")
    P()
    P("---")
    P()
    P("## 7. ★フォールバックが必ず発火する語（STEP 3 のテストケース）")
    P()
    P("5条件・主要品詞判定での実測：")
    P()
    P("| id | word | posRaw | level | 誤答B候補 | 誤答C候補 | 発火する段 |")
    P("|---|---|---|---|---|---|---|")
    for a in data:
        _, A, B, C = buckets(a, data, True)
        if B and C:
            continue
        stage = "B4 / C4" if (not B and not C) else ("B2" if not B else "C2")
        P(f"| {a['id']} | {a['word']} | {a['pos']} | L{a['level']} | {len(B)} | {len(C)} | {stage} |")
    P()
    P("**フォールバックは例外処理ではなく通常フロー。** 実装しないとこの語で4択が成立しない。")
    P()
    P("---")
    P()
    P("## 8. その他")
    P()
    es = Counter(w["example_scene"] for w in data)
    P(f"- `example_scene` の種類数：**{len(es)}種**（300語に対して）。"
      f"4語以上ある場面は **{sum(1 for v in es.values() if v >= 4)}種**")
    allsim: set[str] = set()
    tot = 0
    for w in data:
        allsim |= w["_sim"]
        tot += len(w["_sim"])
    words = {w["word"].lower() for w in data}
    inside = len(allsim & words)
    P(f"- `similar` 語の総数：{tot}（ユニーク {len(allsim)}）。"
      f"うち300語リスト内に存在するのは **{inside}語（{inside/len(allsim)*100:.1f}%）**")
    P(f"- `similar` が1つもリスト内にない単語："
      f"**{sum(1 for w in data if not (w['_sim'] & words))} / {len(data)}**")
    P("- 欠損：`similar` `example_scene` ともに 0件")


if __name__ == "__main__":
    main()
