import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";

// Pre-login pages (landing, log in, sign up, onboarding) use IBM Plex: condensed for headlines,
// mono for times and labels. The app itself stays on Geist.
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
const condensed = IBM_Plex_Sans_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-plex-condensed",
});
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });

/** Put on the outermost element of a pre-login page: loads the fonts and sets Plex as the text font. */
export const marketingFonts = `${sans.variable} ${condensed.variable} ${mono.variable} font-plex`;
