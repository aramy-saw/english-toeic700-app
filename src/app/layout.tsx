import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * ★Web フォントを読み込まない（docs/spec.md §13-4・§13-6 d）。
 *   フォントはシステムフォントのみ。指定は globals.css の
 *   --font-ja / --font-en に集約してある。
 */

/** 本番URL。OGP の絶対URL生成に要る（相対パスはこれを基準に展開される） */
const SITE_URL = "https://english-toeic700-app.vercel.app";

/**
 * ★description は「単語アプリ」ではなく「原因が分かる」を主語にする。
 *   このアプリの主張は誤答の原因分析（§1 の課題②）であり、
 *   単語帳としての側面ではない。SNS のカードに出るのはこの1文だけなので、
 *   ここで主張を取り違えると中身と食い違う。
 *
 * ★感嘆符と絵文字を使わない（§13-10 b）。文言の規則は OGP にも適用する。
 */
const TITLE = "ENGLISH700 — なぜ間違えたかが、わかる。";
const DESCRIPTION =
  "TOEIC700点を目指す社会人のための英単語アプリ。4択の結果から、間違えた原因を「品詞の取り違え」「意味の記憶があいまい」「思い出すのに時間がかかった」に分類し、原因ごとの説明を返します。";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    locale: "ja_JP",
    url: SITE_URL,
    siteName: "ENGLISH700",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    // ★og画像は src/app/opengraph-image.tsx が生成する。
    //   画像のURL・寸法・type のメタタグは Next.js が自動で足すので、ここには書かない
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

/**
 * ★`viewportFit: "cover"` が無いと `env(safe-area-inset-*)` は常に 0 を返す
 *   （2026-08-17 実機確認で発覚）。Dock の下余白がホームバーぶんを
 *   確保できていなかった。Next.js の既定 viewport には viewport-fit が入らない。
 *
 * ★cover にすると描画領域がホームバーの下まで広がるので、
 *   下端に触るものを置くコンポーネント（Dock）は必ず
 *   env(safe-area-inset-bottom) を padding に足すこと。
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // ★lang="ja"。スクリーンリーダーの読み上げ言語の判定に効く。
    //   en のままだと日本語の説明文が英語として読まれる
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
