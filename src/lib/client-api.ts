export async function api<T>(url: string, value?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    ...(value === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
    signal, cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The request could not be completed");
  return result as T;
}
