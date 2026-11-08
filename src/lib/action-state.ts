import type { z } from "zod";

// Shape returned by Server Actions used with useActionState.
export type ActionState = { error?: string; ok?: string } | null;

export function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Check the form and try again.";
}

// Turns Postgres / PostgREST errors into something staff can act on.
export function friendlyDbError(error: { code?: string; message: string }) {
  switch (error.code) {
    case "23505":
      return "That name is already used. Pick a different one.";
    case "42501":
      return "You don't have permission to do that.";
    case "23514":
      return "One of the values is out of range.";
    case "23503":
      return "This has session history, so it can't be deleted. Disable it instead.";
    default:
      return error.message;
  }
}
