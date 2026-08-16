import { describe, expect, it } from "vitest";
import { RESPONSE_SCHEMA } from "@/lib/prompts/schema";

/**
 * なぜテストすべきか：
 * structured outputs は「スキーマが正しいこと」が前提の仕組み。
 * 非対応キーワードを1つ混ぜるだけで API がエラーを返し、AI経路が丸ごと死ぬ。
 * また cause_label をスキーマに残すと、AIがラベルを揺らす余地が復活する。
 *
 * ★各テストは先に「構造が存在すること」を確認する。
 *   これが無いと、スキーマが空オブジェクトのままでも
 *   「非対応キーワードを含まない」が真になって素通りしてしまう。
 */

const json = () => JSON.stringify(RESPONSE_SCHEMA);

describe("RESPONSE_SCHEMA", () => {
  it("非対応キーワードを含まない", () => {
    // なぜ：maxLength / maxItems 等は structured outputs で使えない（spec.md §10-1）。
    //       枚数と文字数はプロンプト本文とアプリ側で担保する
    const s = json();
    expect(s).toContain("review_cards"); // 構造ガード
    for (const kw of [
      "maxLength",
      "minLength",
      "maxItems",
      "minItems",
      "minimum",
      "maximum",
    ]) {
      expect(s, `${kw} は使えない`).not.toContain(kw);
    }
  });

  it("cause_label を含まない（2026-08-16 の決定）", () => {
    // なぜ：cause から一意に決まる値なのでAIに生成させない（spec.md §10-9）。
    //       スキーマから消えていれば、文言が揺れる余地が構造的にゼロになる
    const s = json();
    expect(s).toContain("explanation"); // 構造ガード
    expect(s).not.toContain("cause_label");
  });

  it("全オブジェクトに additionalProperties: false がある", () => {
    // なぜ：structured outputs の必須要件（spec.md §10-1）。
    //       1箇所でも欠けると API がスキーマを受け付けない
    const s = json();
    expect(s).toContain("review_cards"); // 構造ガード

    const walk = (node: unknown, path: string): void => {
      if (typeof node !== "object" || node === null) return;
      const obj = node as Record<string, unknown>;
      if (obj.type === "object") {
        expect(
          obj.additionalProperties,
          `${path} に additionalProperties: false が無い`,
        ).toBe(false);
      }
      for (const [k, v] of Object.entries(obj)) walk(v, `${path}.${k}`);
    };
    walk(RESPONSE_SCHEMA, "$");
  });
});
