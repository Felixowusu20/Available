import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { dummyVerify, verifyPassword } from "@/lib/password";
import { clientIp, rateLimit, rateLimitPeek } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validation";

export class EmailNotVerified extends CredentialsSignin {
  code = "email_not_verified";
}
export class TooManyAttempts extends CredentialsSignin {
  code = "too_many_attempts";
}

// To add Google later: install the provider, add it to `providers` below, and add
// PrismaAdapter(db) (@auth/prisma-adapter). The Account table already exists. Keep
// `session.strategy = "jwt"`, which the Credentials provider requires.
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        // Only FAILED attempts use up the allowance, so students who log in often are never locked out.
        // The per-IP limit is generous because many students can share one campus or café connection.
        const WINDOW = 15 * 60;
        const ipKey = `login:ip:${clientIp(request.headers)}`;
        const emailKey = `login:email:${email}`;
        const byIp = await rateLimitPeek(ipKey, 30, WINDOW);
        const byEmail = await rateLimitPeek(emailKey, 8, WINDOW);
        if (!byIp.ok || !byEmail.ok) throw new TooManyAttempts();
        const fail = async () => {
          await rateLimit(ipKey, 30, WINDOW);
          await rateLimit(emailKey, 8, WINDOW);
          return null;
        };

        const user = await db.user.findUnique({ where: { email } });
        if (!user?.passwordHash) {
          await dummyVerify(password);
          return fail();
        }
        if (!(await verifyPassword(user.passwordHash, password))) return fail();
        if (env().REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) throw new EmailNotVerified();

        await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        logger.info({ userId: user.id }, "login");
        return { id: user.id, email: user.email, name: user.name, role: user.role, tokenVersion: user.tokenVersion };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id as string;
        token.role = user.role;
        token.tv = user.tokenVersion;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.uid as string;
      session.user.role = token.role as "STUDENT" | "ADMIN";
      session.tv = token.tv ?? 0;
      return session;
    },
  },
});
