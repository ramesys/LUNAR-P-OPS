/** Prevent older asynchronous selections from replacing newer ones. */
export class SelectionGuard {
  private sequence: number = 0;
  next(): number { return ++this.sequence; }
  invalidate(): void { this.sequence++; }
  isCurrent(value: number): boolean { return value === this.sequence; }
}
