import { next } from "@vercel/functions/middleware";
import { guard } from "./src/gate/gate.js";
import { googleEnvFrom } from "./src/gate/google.js";

// Vercel Routing Middleware: runs in front of every file this project serves (see src/gate/gate.ts).
export default async function middleware(request: Request): Promise<Response> {
  const answer = await guard(request, {
    password: process.env.ADMIN_PASSWORD,
    google: googleEnvFrom({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
      emails: process.env.ADMIN_GOOGLE_EMAILS,
    }),
    secret: process.env.ADMIN_SESSION_SECRET,
  });
  return answer ?? next({ headers: { "cache-control": "private, no-store" } });
}
