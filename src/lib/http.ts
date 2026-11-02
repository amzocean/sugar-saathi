import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { COOKIE_NAME, verifySession } from "./auth";
import { AppError } from "./errors";

export async function requireSession() {
  const session = verifySession((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) throw new AppError(401, "Please sign in again");
  return session;
}

export function sameOrigin(request: Request) {
  const expected = new URL(request.url);
  // Next's internal URL can use localhost while the browser uses the actual request Host.
  expected.host = request.headers.get("host") ?? expected.host;
  if (request.headers.get("origin") !== expected.origin) {
    throw new AppError(403, "This request must come from the app");
  }
}

export async function body(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError(415, "Expected JSON");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "A request body is required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 8192) {
      await reader.cancel();
      throw new AppError(413, "Request is too large");
    }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new AppError(400, "Invalid JSON"); }
}

export function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export async function route(action: () => Promise<Response>) {
  try { return await action(); }
  catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    if (error instanceof ZodError) return json({ error: error.issues[0]?.message ?? "Please check the entered information" }, 400);
    // Do not log request bodies or provider errors: they can contain health data or credentials.
    return json({ error: "The service could not complete this request. Nothing is confirmed saved; retry to reconcile the outcome." }, 503);
  }
}
