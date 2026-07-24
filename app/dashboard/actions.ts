"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { createSupabaseExpenseClient } from "@/lib/supabase-server";

export async function deleteExpense(expenseId: number): Promise<void> {
  const session = await auth();

  if (!session?.user) {
    throw new Error("You must be signed in to delete an expense.");
  }

  if (!Number.isSafeInteger(expenseId) || expenseId <= 0) {
    throw new Error("Invalid expense ID.");
  }

  const client = createSupabaseExpenseClient();
  const { error } = await client.from("expenses").delete().eq("id", expenseId);

  if (error) {
    throw new Error(`Unable to delete expense: ${error.message}`);
  }

  revalidatePath("/dashboard");
}
