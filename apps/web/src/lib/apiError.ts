/** Turn a FastAPI error body (string detail or pydantic error list) into readable text. */
export function describeApiError(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null && "detail" in body) {
    const detail: unknown = body.detail;
    if (typeof detail === "string") {
      return detail;
    }
    if (Array.isArray(detail)) {
      const messages: string[] = detail
        .map((item: unknown): string =>
          typeof item === "object" && item !== null && "msg" in item && typeof item.msg === "string"
            ? item.msg
            : "",
        )
        .filter((message: string): boolean => message !== "");
      if (messages.length > 0) {
        return messages.join("; ");
      }
    }
  }
  return `Request failed (HTTP ${status.toString()})`;
}
