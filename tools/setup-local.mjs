import { randomBytes, scryptSync } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { emitKeypressEvents } from "node:readline";

async function password() {
  if (!process.stdin.isTTY) throw new Error("Run setup in an interactive terminal; do not pass passwords as command arguments.");
  process.stdout.write("Choose a family password (at least 12 characters): ");
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    function done(error) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("keypress", key);
      process.stdout.write("\n");
      if (error) reject(error); else resolve(value);
    }
    function key(text, event) {
      if (event.ctrl && event.name === "c") return done(new Error("Setup cancelled"));
      if (event.name === "return") return done();
      if (event.name === "backspace") { value = value.slice(0, -1); return; }
      if (text && !event.ctrl && !event.meta && !/[\r\n\x00-\x1f]/.test(text)) value += text;
    }
    process.stdin.on("keypress", key);
  });
}

try {
  const value = await password();
  if (value.length < 12 || value.length > 256) throw new Error("Use a password of 12 to 256 characters. Nothing was written.");
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(value, salt, 64).toString("hex");
  const secret = randomBytes(32).toString("hex");
  await writeFile(".env.local", `FAMILY_PASSWORD_HASH=scrypt:${salt}:${hash}\nSESSION_SECRET=${secret}\nDATA_STORAGE=local\nVOICE_PROTOTYPE_ENABLED=false\nOPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini\n`, { flag: "wx", mode: 0o600 });
  console.log("Created .env.local. No password was printed or stored in plaintext. Run npm run dev.");
} catch (error) {
  console.error(error.code === "EEXIST" ? ".env.local already exists; it was not overwritten." : error.message);
  process.exitCode = 1;
}
