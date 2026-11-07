// Public details shown on the website (Contact page, footer). Fill these in; anything left
// empty is simply not shown.
type Contact = { email: string; phone: string; whatsapp: string; city: string; hours: string };

export const SITE: { name: string; contact: Contact; pcClip: string } = {
  name: "QueSys",
  /**
   * Home page, How it works: a video to play on PC-04 instead of the built-in racing animation.
   * Put the file in /public and give its path, e.g. "/landing/pc-clip.mp4" (muted, loops; keep it
   * short and small, under ~3 MB). Only use footage you have the rights to show. Empty = the
   * built-in animation.
   */
  pcClip: "/landing/pc-clip.mp4",
  contact: {
    /** e.g. "hello@quesys.in" */
    email: "",
    /** Phone number people can call, with country code, e.g. "+91 98765 43210" */
    phone: "",
    /** WhatsApp number, digits only with country code, e.g. "919876543210" */
    whatsapp: "",
    /** City or area you're based in, e.g. "Pune, Maharashtra" */
    city: "",
    /** When you usually reply, e.g. "Mon–Sat, 11 am to 8 pm" */
    hours: "",
  },
};

export function hasContactDetails() {
  const c = SITE.contact;
  return Boolean(c.email || c.phone || c.whatsapp);
}
