import { next } from "@vercel/functions/middleware";
import { guard } from "./src/gate/gate.js";

// Vercel Routing Middleware: runs in front of every file this project serves (see src/gate/gate.ts).
export default async function middleware(request: Request): Promise<Response> {
  const answer = await guard(request, {
    password: process.env.ADMIN_PASSWORD,
    secret: process.env.ADMIN_SESSION_SECRET,
  });
  return answer ?? next({ headers: { "cache-control": "private, no-store" } });
}
