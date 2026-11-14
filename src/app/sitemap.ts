import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

// Public pages only: everything behind a login stays out of search.
const PAGES: [path: string, priority: number][] = [
  ["/", 1],
  ["/plans", 0.9],
  ["/snooker-club-software", 0.8],
  ["/ps5-lounge-software", 0.8],
  ["/cyber-cafe-software", 0.8],
  ["/about", 0.5],
  ["/contact", 0.5],
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await siteUrl();
  return PAGES.map(([path, priority]) => ({ url: `${base}${path}`, changeFrequency: "monthly", priority }));
}
