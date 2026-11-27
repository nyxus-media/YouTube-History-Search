declare const GM: {
  addValueChangeListener(
    key: string,
    callback: (key: string, oldValue: unknown, newValue: unknown, remote: boolean) => void
  ): string | number | Promise<string | number>;
  removeValueChangeListener(id: string | number): void | Promise<void>;
  getValue<T = unknown>(key: string, defaultValue?: T): Promise<T>;
  setValue(key: string, value: unknown): Promise<void>;
  deleteValue(key: string): Promise<void>;
  getValues?(keys: string[]): Promise<Record<string, unknown>>;
  setValues?(values: Record<string, unknown>): Promise<void>;
};

declare const unsafeWindow: Window & Record<string, unknown>;

declare function exportFunction<T extends (...args: never[]) => unknown>(value: T, target: object, options: { allowCrossOriginArguments: boolean }): T;
