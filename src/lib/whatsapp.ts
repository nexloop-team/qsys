// Opens WhatsApp (app on phones, web on desktop) with a message ready to send to an Indian mobile.
// Click-to-chat: no WhatsApp Business account needed; staff tap Send themselves.
export function whatsAppUrl(phone: string, text: string) {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

export function openWhatsApp(phone: string, text: string) {
  window.open(whatsAppUrl(phone, text), "_blank", "noopener,noreferrer");
}
