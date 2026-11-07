"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { firstIssue, type ActionState } from "@/lib/action-state";
import { TOPICS, type Topic } from "./topics";

const schema = z
  .object({
    name: z.string().trim().min(2, "Enter your name.").max(80),
    email: z
      .string()
      .trim()
      .max(120)
      .transform((v) => v || null)
      .pipe(z.email("Enter a valid email.").nullable()),
    phone: z
      .string()
      .transform((v) => v.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "") || null)
      .pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number.").nullable()),
    venue: z.string().trim().max(80).transform((v) => v || null),
    topic: z.enum(Object.keys(TOPICS) as [Topic, ...Topic[]], "Pick what it's about."),
    message: z.string().trim().min(10, "Tell us a little more (at least 10 characters).").max(2000),
  })
  .refine((v) => v.email || v.phone, { message: "Give an email or a mobile number so we can reply." });

// Sends a contact message. Bots are filtered by a hidden field and by how fast the form was sent.
export async function sendContactMessage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // Hidden "website" field: people never see it, bots fill it in. Pretend it worked.
  if (String(formData.get("website") ?? "").trim()) return { ok: "Thanks! We'll get back to you soon." };
  const openedAt = Number(formData.get("opened_at"));
  if (Number.isFinite(openedAt) && Date.now() - openedAt < 3000) {
    return { error: "That was quick! Please check your message and send it again." };
  }

  const parsed = schema.safeParse({
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    venue: formData.get("venue") ?? "",
    topic: formData.get("topic") ?? "",
    message: formData.get("message") ?? "",
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  // Only a one-way hash of the network address is kept, to limit floods.
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "";
  const senderHash = ip ? createHash("sha256").update(`qs-contact:${ip}`).digest("hex") : null;

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_contact_message", {
    p_name: parsed.data.name,
    p_email: parsed.data.email,
    p_phone: parsed.data.phone,
    p_venue: parsed.data.venue,
    p_topic: parsed.data.topic,
    p_message: parsed.data.message,
    p_sender_hash: senderHash,
  });
  if (error) {
    return { error: error.code === "22023" ? error.message : "Couldn't send your message. Please try again in a minute." };
  }
  return { ok: "Thanks! We'll get back to you soon." };
}
