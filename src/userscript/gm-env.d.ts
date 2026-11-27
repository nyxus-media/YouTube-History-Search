declare const GM: {
  getValue<T = unknown>(key: string, defaultValue?: T): Promise<T>;
  setValue(key: string, value: unknown): Promise<void>;
  deleteValue(key: string): Promise<void>;
  getValues?(keys: string[]): Promise<Record<string, unknown>>;
  setValues?(values: Record<string, unknown>): Promise<void>;
};

declare const unsafeWindow: Window & Record<string, unknown>;
