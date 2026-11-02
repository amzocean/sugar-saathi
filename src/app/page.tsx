import { cookies } from "next/headers";
import { COOKIE_NAME, authConfig, verifySession } from "@/lib/auth";
import { storage } from "@/lib/store";
import SaathiApp from "@/components/SaathiApp";

export const dynamic = "force-dynamic";
export default async function Home() {
  let configurationError = "";
  let authenticated = false;
  try {
    authConfig();
    storage();
    authenticated = !!verifySession((await cookies()).get(COOKIE_NAME)?.value);
  } catch (error) {
    configurationError = error instanceof Error ? error.message : "Server configuration is incomplete";
  }
  return <SaathiApp
    initiallyAuthenticated={authenticated}
    configurationError={configurationError}
    local={process.env.DATA_STORAGE === "local"}
  />;
}
