import { describe, it, expect, vi } from "vitest";
import { DebugLog } from "./debug-log.js";

// ─── DebugLog ────────────────────────────────────────────────────

describe("DebugLog", () => {
  it("behaves as a regular array when no callback is given", () => {
    const log = new DebugLog();
    log.push("line 1");
    log.push("line 2");
    expect(log).toEqual(["line 1", "line 2"]);
    expect(log.length).toBe(2);
  });

  it("calls onDebug for each pushed item", () => {
    const onDebug = vi.fn();
    const log = new DebugLog(onDebug);
    log.push("a");
    log.push("b");
    expect(onDebug).toHaveBeenCalledTimes(2);
    expect(onDebug).toHaveBeenNthCalledWith(1, "a");
    expect(onDebug).toHaveBeenNthCalledWith(2, "b");
  });

  it("calls onDebug for each item in a multi-argument push", () => {
    const onDebug = vi.fn();
    const log = new DebugLog(onDebug);
    log.push("x", "y", "z");
    expect(onDebug).toHaveBeenCalledTimes(3);
    // Array.from avoids comparison quirks with Array subclasses
    expect(Array.from(log)).toEqual(["x", "y", "z"]);
  });

  it("stores items in the array regardless of callback", () => {
    const onDebug = vi.fn();
    const log = new DebugLog(onDebug);
    log.push("stored");
    expect(log[0]).toBe("stored");
    expect([...log]).toEqual(["stored"]);
  });

  it("join() works as a plain string array", () => {
    const log = new DebugLog();
    log.push("step 1");
    log.push("step 2");
    expect(log.join("\n")).toBe("step 1\nstep 2");
  });

  it("step() numbers steps consecutively and leaves plain pushes unnumbered", () => {
    const onDebug = vi.fn();
    const log = new DebugLog(onDebug);
    log.step("Navigating");
    log.push("  detail line");
    log.step("Filling password");
    expect([...log]).toEqual(["1. Navigating", "  detail line", "2. Filling password"]);
    expect(onDebug).toHaveBeenLastCalledWith("2. Filling password");
  });

  it("keeps independent counters per log", () => {
    const a = new DebugLog();
    const b = new DebugLog();
    a.step("x");
    a.step("y");
    b.step("z");
    expect(b[0]).toBe("1. z");
  });
});
