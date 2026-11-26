/** Cognito tokens live only in this instance's Map, never in browser persistence. */
export class MemoryTokenStorage {
  private readonly values = new Map<string, string>();

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }

  async clear(): Promise<void> {
    this.values.clear();
  }
}
