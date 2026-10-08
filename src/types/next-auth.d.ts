import type { DefaultSession } from "next-auth";

type AppRole = "STUDENT" | "ADMIN";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: AppRole } & DefaultSession["user"];
    /** tokenVersion at sign-in; compared with the database to revoke old sessions. */
    tv: number;
  }
  interface User {
    role?: AppRole;
    tokenVersion?: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
    role?: AppRole;
    tv?: number;
  }
}
