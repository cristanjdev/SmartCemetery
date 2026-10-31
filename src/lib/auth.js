import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { getClientIp, writeAuditLog } from "@/lib/audit";
import { boundedRateLimit, clearRateLimit, consumeRateLimit } from "@/lib/rate-limit";

// The form shows one generic message for every rejected sign-in, on purpose.
// While developing, the terminal running `npm run dev` says why (never the
// password, never in production), so a typo in the email or a missing account
// is not mistaken for a bug.
function devHint(reason) {
  if (process.env.NODE_ENV === "development") console.warn(`[auth] sign-in rejected: ${reason}`);
}

// A server fault (database down, a migration not applied) shows the visitor a
// generic message; this puts the real cause in the server log so it can be
// fixed. Only the error text is logged: no credentials, no account data.
function logAuthFailure(what, error) {
  const text = String(error?.message || error);
  const detail = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
  let fix = "";
  if (error?.code === "P1001" || /can't reach database server|ECONNREFUSED/i.test(text)) {
    fix = "MySQL is not running or not reachable: open the XAMPP Control Panel and press Start next to MySQL, and check DATABASE_URL.";
  } else if (/doesn't exist|unknown column|1146|1054/i.test(text)) {
    fix = "A table or column is missing: stop the dev server and run `npm run db:migrate`.";
  } else if (/access denied|P1000/i.test(text)) {
    fix = "MySQL refused the login: check the user and password in DATABASE_URL.";
  }
  console.error(`[auth] sign-in unavailable: ${what}. ${detail}${fix ? ` — ${fix}` : ""}`);
}

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email.trim().toLowerCase();
        const ipAddress = getClientIp(request);
        const loginLimit = boundedRateLimit("LOGIN_RATE_LIMIT_MAX", 5, 1, 100);
        const windowSeconds = boundedRateLimit("LOGIN_RATE_LIMIT_WINDOW_SECONDS", 900, 60, 86_400);
        let throttle;
        try {
          throttle = await consumeRateLimit({
            scope: "login",
            identifier: `${getClientIp(request) || "unresolved"}:${email}`,
            limit: loginLimit,
            windowMs: windowSeconds * 1000,
          });
        } catch (error) {
          // Authentication fails closed if the shared limiter cannot verify
          // the attempt. Do not reveal whether an account exists.
          logAuthFailure("the sign-in limiter could not reach its table (rate_limit_buckets)", error);
          throw new Error("Service temporarily unavailable. Please try again later.");
        }
        if (!throttle.allowed) {
          // Never store the attempted email: it may be a mistyped password.
          await writeAuditLog({ userId: null, action: "auth.login_blocked", ipAddress });
          const retryMinutes = Math.ceil(throttle.retryAfterSeconds / 60);
          throw new Error(
            `Too many login attempts. Your account is temporarily locked. Please try again in ${retryMinutes} minute${retryMinutes === 1 ? "" : "s"}.`
          );
        }

        let user;
        try {
          user = await prisma.user.findUnique({
            where: { email },
            include: { userType: true },
          });
        } catch (error) {
          logAuthFailure("the accounts could not be read", error);
          throw new Error("Database connection failed. Please try again later.");
        }

        if (!user) {
          devHint(`no account with the email "${email}". Run \`npm run db:users\` to list the accounts that exist.`);
        } else if (user.status !== "active") {
          devHint(`the account "${email}" is ${user.status}.`);
        }
        if (!user || user.status !== "active") {
          await writeAuditLog({ userId: user ? user.id : null, action: "auth.login_failed", ipAddress });
          throw new Error("Invalid email or password. Please check your credentials and try again.");
        }

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!isValid) {
          devHint(`wrong password for "${email}". \`npm run db:setup\` resets the default accounts and prints their passwords.`);
          await writeAuditLog({ userId: user.id, action: "auth.login_failed", ipAddress });
          throw new Error("Invalid email or password. Please check your credentials and try again.");
        }
        await clearRateLimit(throttle.key).catch(() => {});
        await writeAuditLog({ userId: user.id, action: "auth.login", ipAddress });

        return {
          id: String(user.id),
          name: user.name,
          email: user.email,
          role: user.userType.typeName,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.disabled = false;
        return token;
      }

      // Re-check account state whenever NextAuth refreshes the JWT. This makes
      // disabled/deleted users fail closed without waiting for the 8-hour JWT
      // lifetime, while a transient database outage preserves the signed token
      // rather than silently changing authorization claims.
      if (token?.id) {
        try {
          const current = await prisma.user.findUnique({
            where: { id: Number(token.id) },
            select: { status: true, userType: { select: { typeName: true } } },
          });
          if (!current || current.status !== "active") {
            token.disabled = true;
          } else {
            token.disabled = false;
            token.role = current.userType.typeName;
          }
        } catch {
          // Authoritative API guards still verify the signed token. Do not log
          // user identifiers or turn a transient auth-store outage into a leak.
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.disabled = token.disabled === true;
      }
      return session;
    },
  },
  events: {
    // NextAuth gives sign-out no request, so there is no IP to record here.
    async signOut({ token }) {
      if (token?.id) await writeAuditLog({ userId: token.id, action: "auth.logout" });
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours
  },
  secret: process.env.NEXTAUTH_SECRET,
};
