/**
 * Array de strings que llama a un callback en cada push.
 * Úsalo en lugar de `string[]` para transmitir logs en tiempo real.
 */
export class DebugLog extends Array<string> {
  private readonly _onDebug?: (line: string) => void;
  #stepCount = 0;

  constructor(onDebug?: (line: string) => void) {
    super();
    this._onDebug = onDebug;
  }

  override push(...items: string[]): number {
    for (const item of items) {
      super.push(item);
      this._onDebug?.(item);
    }
    return this.length;
  }

  /** Registra el siguiente paso del flujo, numerado automáticamente (`"3. mensaje"`). */
  step(message: string): void {
    this.push(`${++this.#stepCount}. ${message}`);
  }
}
