import { auth } from "@/auth";

export const proxy = auth;

export const config = {
  matcher: "/((?!api/auth|api/v1|_next/static|_next/image|favicon.ico).*)"
};
