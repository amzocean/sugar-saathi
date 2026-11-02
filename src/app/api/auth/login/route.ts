import { z } from "zod";
import { COOKIE_NAME, SESSION_SECONDS, authConfig, createSession, passwordMatches } from "@/lib/auth";
import { body, json, route, sameOrigin } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { reserveLoginAttempt } from "@/lib/records";
import { storage } from "@/lib/store";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return route(async () => {
    sameOrigin(request);
    authConfig();
    const { password } = z.object({ password: z.string().min(1).max(256) }).strict().parse(await body(request));
    await reserveLoginAttempt(storage());
    if (!passwordMatches(password)) throw new AppError(401, "That password did not match");
    const { token } = createSession();
    const response = json({ ok: true });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true, secure: process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:",
      sameSite: "lax", path: "/", maxAge: SESSION_SECONDS,
    });
    return response;
  });
}
