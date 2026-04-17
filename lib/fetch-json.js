export async function fetchJson(input, init) {
  const response = await fetch(input, init);
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ??
        payload?.message ??
        (typeof payload === "string" && payload.trim() ? payload : `HTTP ${response.status}`)
    );
  }

  return payload;
}
