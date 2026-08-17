/**
 * `/review`（docs/spec.md §12-1・§13-7 c）。
 *
 * ★`/` と同じく薄い Server Component に保つ。
 *   localStorage を読むのはクライアント側の ReviewRoot。
 */
import { ReviewRoot } from "@/components/ReviewRoot";

export default function Page() {
  return <ReviewRoot />;
}
