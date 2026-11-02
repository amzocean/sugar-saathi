import { rm } from "node:fs/promises";
import path from "node:path";

export default async function resetSyntheticBrowserData() {
  await rm(path.join(process.cwd(), "tests", ".browser-data"), { recursive: true, force: true });
}
