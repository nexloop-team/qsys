import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await siteUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // The app itself and players' private pages (station QR, booking forms) aren't for search.
      disallow: ["/dashboard", "/bills", "/players", "/reports", "/settings", "/stations", "/expenses", "/inventory", "/bookings", "/tournaments", "/pricing", "/s/", "/onboarding"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
