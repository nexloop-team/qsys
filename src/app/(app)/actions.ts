"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { ACTIVE_BRANCH_COOKIE, getAppContext } from "@/lib/dal";

export async function setActiveBranch(branchId: string) {
  const { branches } = await getAppContext();
  if (!branches.some((b) => b.id === branchId)) return;

  (await cookies()).set(ACTIVE_BRANCH_COOKIE, branchId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  refresh();
}
