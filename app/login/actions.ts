"use server";

import { signIn, signOut } from "@/auth";

function safeCallbackUrl(value: FormDataEntryValue | null): string {
  const nextPath = String(value ?? "/dashboard");

  return nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/dashboard";
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  await signIn("google", {
    redirectTo: safeCallbackUrl(formData.get("next"))
  });
}

export async function signOutOfDashboard(): Promise<void> {
  await signOut({
    redirectTo: "/login"
  });
}
