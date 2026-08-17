import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * スマホ実機から LAN 越しに dev サーバーを開くための許可（STEP 6 段階3）。
   *
   * Next.js は開発時、初期化したホスト名（既定は localhost）以外のオリジンからの
   * dev 専用アセットへのリクエストを 403 で拒む。許可しないと
   * `/_next/static/chunks/*` が 403 になり、SSR の HTML だけが出て
   * React が起動しない（＝タップが効かない）状態になる。
   *
   * ★開発時のみ有効。 `blockCrossSiteDEV` の呼び出しは
   *   next/dist/server/lib/router-server.js の `if (development)` の内側だけにあり、
   *   `next build` / `next start` はこの値を読まない。本番の挙動は変わらない。
   *
   * ★IP は自宅LANのもの。 変わったら書き換える。
   *   ネットワークが変わって 403 が出たら、まずここを疑う。
   */
  allowedDevOrigins: ["192.168.11.23"],

  /**
   * 開発ツールのインジケータ（左下の N マーク）を消す（STEP 6 段階3）。
   *
   * ★理由は下端の実機確認ができないこと。 既定位置が bottom-left で、
   *   「わからない／やめる」に被る。このアプリは §12-7 で
   *   主要な操作をすべて画面下端に置くため、段階4・5 でも同じ場所で邪魔になる。
   *   位置を bottom-right にずらしても「やめる」に被るので、消すのが早い。
   *
   * ★開発時のみ。 build/define-env.js が `process.env.__NEXT_DEV_INDICATOR` に
   *   畳み、それを読むのは client/dev/hot-reloader 配下の HMR コードだけ。
   *   本番バンドルには含まれない。
   *
   * ★エラー表示は消えない。 false が消すのはインジケータのみで、
   *   コンパイルエラーとランタイムエラーのオーバーレイは従来どおり出る。
   */
  devIndicators: false,
};

export default nextConfig;
