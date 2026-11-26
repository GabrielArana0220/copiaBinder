// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { MemoryTokenStorage } from "../src/features/auth/memory-storage";

describe("memory-only Cognito storage", () => {
  it("implements asynchronous get/set/remove/clear with isolated Maps", async () => {
    const first = new MemoryTokenStorage();
    const second = new MemoryTokenStorage();
    expect(await first.getItem("fixture-key")).toBeNull();
    await first.setItem("fixture-key", "fixture-token-value");
    expect(await first.getItem("fixture-key")).toBe("fixture-token-value");
    expect(await second.getItem("fixture-key")).toBeNull();
    await first.removeItem("fixture-key");
    expect(await first.getItem("fixture-key")).toBeNull();
    await first.setItem("fixture-a", "fixture-a-value");
    await first.setItem("fixture-b", "fixture-b-value");
    await first.clear();
    expect(await first.getItem("fixture-a")).toBeNull();
    expect(await first.getItem("fixture-b")).toBeNull();
  });

  it("never reads or writes localStorage/sessionStorage (including a new instance)", async () => {
    const persistentSet = vi.spyOn(Storage.prototype, "setItem");
    const persistentGet = vi.spyOn(Storage.prototype, "getItem");
    const persistentRemove = vi.spyOn(Storage.prototype, "removeItem");
    const persistentClear = vi.spyOn(Storage.prototype, "clear");
    const storage = new MemoryTokenStorage();
    await storage.setItem("fixture-key", "fixture-access-token");
    await storage.getItem("fixture-key");
    await storage.removeItem("fixture-key");
    await storage.clear();
    expect(await new MemoryTokenStorage().getItem("fixture-key")).toBeNull();
    expect(persistentSet).not.toHaveBeenCalled();
    expect(persistentGet).not.toHaveBeenCalled();
    expect(persistentRemove).not.toHaveBeenCalled();
    expect(persistentClear).not.toHaveBeenCalled();
  });
});
