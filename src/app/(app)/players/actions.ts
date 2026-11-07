"use server";

import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAppContext, requireRole } from "@/lib/dal";
import { firstIssue, friendlyDbError, type ActionState } from "@/lib/action-state";

const phone = z
  .string()
  .transform((v) => v.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, ""))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number."));
const name = z.string().trim().min(2, "Enter the player's name.").max(80);

export async function addPlayer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { org } = await getAppContext();
  const parsed = z.object({ phone, name }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_customer", {
    p_org_id: org.id,
    p_phone: parsed.data.phone,
    p_name: parsed.data.name,
  });
  if (error) return { error: error.code === "23505" ? error.message : friendlyDbError(error) };
  refresh();
  return { ok: "Player added." };
}

export async function updatePlayer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["owner"]);
  const parsed = z.object({ id: z.uuid(), phone, name }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ name: parsed.data.name, phone: parsed.data.phone })
    .eq("id", parsed.data.id);
  if (error) {
    return { error: error.code === "23505" ? "Another player already has this mobile number." : friendlyDbError(error) };
  }
  refresh();
  return { ok: "Saved." };
}

// Every balance change goes through the database ledger functions. If one fails, the
// error is shown; nothing is written around it.
export async function managePlayerWallet(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { role, branch } = await getAppContext();
  const rawType = String(formData.get("actionType") || "add");
  const actionType = rawType === "deduct" ? "deduct" : rawType === "clear" ? "clear" : "add";
  if (actionType !== "add" && role !== "owner") {
    return { error: "Only the owner can refund or clear a wallet." };
  }

  const customerId = z.uuid().safeParse(formData.get("customerId"));
  if (!customerId.success) return { error: "Player missing." };

  const amount = Number(formData.get("amount"));
  if (actionType !== "clear" && !(amount >= 1)) return { error: "Amount must be at least ₹1." };

  const method = formData.get("method") === "upi" ? "upi" : "cash";
  const note = String(formData.get("note") || "").trim().slice(0, 100);
  const supabase = await createClient();

  if (actionType === "add") {
    // An owner may set the bonus by hand; otherwise the database applies the venue's offers.
    const rawBonus = String(formData.get("bonus") ?? "").trim();
    const bonus = role === "owner" && rawBonus !== "" ? Number(rawBonus) : null;
    if (bonus !== null && !(bonus >= 0)) return { error: "Bonus must be ₹0 or more." };
    const { error } = await supabase.rpc("topup_wallet", {
      p_customer_id: customerId.data,
      p_amount: amount,
      p_method: method,
      p_note: note || "Deposit",
      p_bonus: bonus,
      p_branch_id: branch.id,
    });
    if (error) return { error: error.message };
  } else {
    let toDeduct = amount;
    if (actionType === "clear") {
      const { data: cust } = await supabase.from("customers").select("wallet_balance").eq("id", customerId.data).single();
      toDeduct = Number(cust?.wallet_balance ?? 0);
      if (toDeduct <= 0) return { ok: "Wallet is already at ₹0." };
    }
    const { error } = await supabase.rpc("deduct_wallet", {
      p_customer_id: customerId.data,
      p_amount: toDeduct,
      p_note: note || (actionType === "clear" ? "Balance cleared" : "Refund"),
      p_method: method,
      p_branch_id: branch.id,
    });
    if (error) return { error: error.message };
  }

  revalidatePath("/players");
  revalidatePath(`/players/${customerId.data}`);
  refresh();
  return {
    ok:
      actionType === "clear"
        ? "Wallet balance cleared to ₹0."
        : actionType === "deduct"
          ? `Deducted ₹${amount} from wallet.`
          : "Wallet topped up successfully.",
  };
}

export const topupPlayerWallet = managePlayerWallet;

// PC login PIN: the player picks 4 digits at the counter; staff type it in. Only its hash is stored.
export async function setPlayerPin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await getAppContext();
  const parsed = z
    .object({
      customerId: z.uuid(),
      pin: z.string().regex(/^\d{4}$/, "The PIN must be 4 digits."),
      pin2: z.string(),
    })
    .refine((v) => v.pin === v.pin2, { message: "The two PINs don't match.", path: ["pin2"] })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_player_pin", {
    p_customer_id: parsed.data.customerId,
    p_pin: parsed.data.pin,
  });
  if (error) return { error: error.code === "22023" ? error.message : friendlyDbError(error) };
  refresh();
  return { ok: "PIN saved. The player can now log in on any free PC." };
}

export async function clearPlayerPin(customerId: string): Promise<{ error?: string }> {
  await getAppContext();
  const id = z.uuid().safeParse(customerId);
  if (!id.success) return { error: "Player missing." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_player_pin", { p_customer_id: id.data });
  if (error) return { error: friendlyDbError(error) };
  refresh();
  return {};
}
