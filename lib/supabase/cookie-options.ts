import type { CookieOptions } from "@supabase/ssr";

/** The deployed app is served over HTTPS (including when exposed through Cloudflare Tunnel). */
export const authCookieOptions: CookieOptions = {
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
};
