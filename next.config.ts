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
};

export default nextConfig;
