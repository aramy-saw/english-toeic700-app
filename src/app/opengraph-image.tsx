/**
 * OGP 画像（docs/spec.md §13-8 の署名要素を絵にしたもの）。
 *
 * ★外部依存を増やさない。 `next/og` は Next.js に同梱されており、
 *   package.json は変わらない。CDN もフォントの外部取得もしない。
 *
 * ★署名要素をそのまま出す。 SNS に出るのはこの1枚だけなので、
 *   アプリを開く前に「これは目盛りで得点を見せるアプリだ」が伝わる状態にする。
 *   §13-7 c の home 図と同じ並び（▇▇▅▇▇▁▅▇▇▇ ＝ 80点）を描いている。
 *
 * ★色は globals.css のトークンと同じ値。 ここは CSS 変数が使えないので直値だが、
 *   値を変えるときは §13-5 a の表と両方を直す。
 */
import { ImageResponse } from "next/og";

export const alt = "ENGLISH700 — なぜ間違えたかが、わかる。";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COLOR = {
  bg: "#0f1216",
  line: "#252b33",
  text: "#e6e9ed",
  sub: "#9aa3ad",
  ok: "#4ade80",
  attn: "#fb923c",
} as const;

/** §13-7 c の図と同じ並び。20 / 10 / 3px を 3.5 倍にしている */
const MARKS: ReadonlyArray<{ h: number; color: string }> = [
  { h: 70, color: COLOR.ok },
  { h: 70, color: COLOR.ok },
  { h: 35, color: COLOR.ok },
  { h: 70, color: COLOR.ok },
  { h: 70, color: COLOR.ok },
  { h: 11, color: COLOR.attn },
  { h: 35, color: COLOR.ok },
  { h: 70, color: COLOR.ok },
  { h: 70, color: COLOR.ok },
  { h: 70, color: COLOR.ok },
];

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: COLOR.bg,
          padding: "72px 80px",
        }}
      >
        <div style={{ display: "flex", fontSize: 32, color: COLOR.sub }}>
          ENGLISH700
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* 署名要素。下端揃え（§13-8） */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
            {MARKS.map((m, i) => (
              <div
                key={i}
                style={{
                  width: 96,
                  height: m.h,
                  background: m.color,
                  borderRadius: 2,
                }}
              />
            ))}
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 56,
              fontSize: 64,
              color: COLOR.text,
            }}
          >
            なぜ間違えたかが、わかる。
          </div>
        </div>

        <div
          style={{
            display: "flex",
            borderTop: `1px solid ${COLOR.line}`,
            paddingTop: 28,
            fontSize: 28,
            color: COLOR.sub,
          }}
        >
          TOEIC 700 / 誤答の原因を3種類に分類する英単語アプリ
        </div>
      </div>
    ),
    size,
  );
}
