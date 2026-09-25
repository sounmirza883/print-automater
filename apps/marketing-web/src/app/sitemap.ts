import type { MetadataRoute } from "next";
import { blogPosts } from "@/content/blog";
import { docsPages } from "@/content/docs";
import { featurePages } from "@/content/feature-pages";
import { guides } from "@/content/guides";
import { siteConfig } from "@/content/site";

export const dynamic = "force-static";

const STATIC_ROUTES = [
  "",
  "/features",
  "/guides",
  "/tutorials",
  "/customer-stories",
  "/support",
  "/about",
  "/careers",
  "/blog",
  "/press",
  "/privacy",
  "/terms",
  "/security",
  "/data-processing",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    ...STATIC_ROUTES,
    ...featurePages.map((f) => `/features/${f.slug}`),
    ...guides.map((g) => `/guides/${g.slug}`),
    ...blogPosts.map((p) => `/blog/${p.slug}`),
    ...docsPages.map((d) => d.href),
  ];
  return paths.map((path) => ({ url: `${siteConfig.url}${path}` }));
}
