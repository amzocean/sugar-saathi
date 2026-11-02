import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";

export const COOKIE_NAME = "saathi_session";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export type Session = { id: string; expiresAt: number };

export function authConfig() {
  const hash = process.env.FAMILY_PASSWORD_HASH;
  const secret = process.env.SESSION_SECRET;
  if (!hash || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash) || !secret || secret.length < 32) {
    throw new AppError(503, "Family login is not configured. Run npm run setup:local, or configure the server environment.");
  }
  return { hash, secret };
}

export function passwordMatches(password: string) {
  const { hash } = authConfig();
  const [, salt, expected] = hash.split(":");
  return timingSafeEqual(Buffer.from(expected, "hex"), scryptSync(password, salt, 64));
}

function signature(payload: string) {
  const { hash, secret } = authConfig();
  return createHmac("sha256", secret).update(`${hash}:${payload}`).digest("base64url");
}

export function createSession(now = Date.now()) {
  const session: Session = { id: randomBytes(24).toString("hex"), expiresAt: now + SESSION_SECONDS * 1000 };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return { session, token: `${payload}.${signature(payload)}` };
}

export function verifySession(token: string | undefined, now = Date.now()): Session | null {
  if (!token || token.length > 1024) return null;
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra) return null;
  const expected = signature(payload);
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    return /^[a-f0-9]{48}$/.test(session.id) && Number.isSafeInteger(session.expiresAt) &&
      session.expiresAt > now && session.expiresAt <= now + SESSION_SECONDS * 1000
      ? session : null;
  } catch {
    return null;
  }
}
