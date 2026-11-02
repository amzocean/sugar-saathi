import { COOKIE_NAME } from "@/lib/auth";
import { json, route, sameOrigin } from "@/lib/http";

export async function POST(request: Request) {
  return route(async () => {
    sameOrigin(request);
    const response = json({ ok: true });
    response.cookies.set(COOKIE_NAME, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:", path: "/", maxAge: 0 });
    return response;
  });
}
