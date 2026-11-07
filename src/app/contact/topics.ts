// What a contact message is about (shown in the form's dropdown).
export const TOPICS = {
  setup: "Setting up my venue",
  pricing: "Pricing",
  pc_app: "The PC app",
  support: "Help with my account",
  other: "Something else",
} as const;

export type Topic = keyof typeof TOPICS;
