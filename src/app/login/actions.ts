"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { logger } from "@/lib/logger";

export type LoginState = { error?: string; unverifiedEmail?: string } | undefined;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  try {
    await signIn("credentials", {
      email,
      password: String(formData.get("password") ?? ""),
      redirectTo: "/dashboard",
    });
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.type !== "CredentialsSignin") {
        // Infrastructure problem (e.g. database down), not the user's mistake.
        logger.error({ type: err.type, cause: String((err.cause as { err?: unknown } | undefined)?.err ?? err.cause) }, "login failed unexpectedly");
        return { error: "We couldn't sign you in right now. Please try again in a moment." };
      }
      const code = (err as { code?: string }).code;
      if (code === "email_not_verified") {
        return { error: "Please verify your email first. Check your inbox for the link.", unverifiedEmail: email };
      }
      if (code === "too_many_attempts") {
        return { error: "Too many attempts. Wait a few minutes and try again." };
      }
      return { error: "Incorrect email or password." };
    }
    throw err; // the redirect on success is thrown as a special error and must propagate
  }
}
