import { describe, expect, it } from "vitest";
import { formatDateLocal, formatTokens } from "../src/render/format";

describe("formatTokens", () => {
  it("formats raw, thousand, million, and billion token counts", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_000)).toBe("1.0K");
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatTokens(2_000_000_000)).toBe("2.0B");
  });
});

describe("formatDateLocal", () => {
  it("formats a local Date as YYYY-MM-DD", () => {
    expect(formatDateLocal(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
