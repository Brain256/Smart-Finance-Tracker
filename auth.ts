import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const allowedEmail = process.env.AUTH_ALLOWED_EMAIL?.toLowerCase();

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  callbacks: {
    authorized({ auth: session }) {
      return Boolean(session?.user);
    },
    signIn({ profile }) {
      if (!allowedEmail || !profile?.email) {
        return false;
      }

      return profile.email.toLowerCase() === allowedEmail;
    }
  },
  pages: {
    signIn: "/login",
    error: "/login"
  }
});
