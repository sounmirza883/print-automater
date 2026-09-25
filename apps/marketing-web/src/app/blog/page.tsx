import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { PageHero, PageShell } from "@/components/pages";
import { Badge, Container } from "@/components/ui";
import { blogPosts, formatPostDate } from "@/content/blog";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Articles on running a print shop: printer failover, moving from chat to a print queue, and what to automate.",
  alternates: { canonical: "/blog" },
};

export default function BlogIndexPage() {
  return (
    <PageShell>
      <PageHero
        eyebrow="Blog"
        title="Notes on running a modern print shop"
        lede="Product thinking and practical guidance. The articles below are placeholders."
        crumbs={[{ label: "Home", href: "/" }, { label: "Blog" }]}
      />
      <Container className="py-14 md:py-20">
        <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {blogPosts.map((post) => (
            <li key={post.slug}>
              <article className="group relative flex h-full flex-col rounded-2xl border border-ink-100 bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md focus-within:border-brand-300">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="brand">{post.tag}</Badge>
                  <Badge variant="warning">Placeholder</Badge>
                </div>
                <h2 className="mt-4 text-xl font-semibold tracking-tight text-ink-900">
                  <a
                    href={`/blog/${post.slug}`}
                    className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600"
                  >
                    {post.title}
                  </a>
                </h2>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-ink-700">{post.excerpt}</p>
                <p className="mt-5 text-sm text-ink-600">
                  <time dateTime={post.date}>{formatPostDate(post.date)}</time> · {post.readMinutes}{" "}
                  min read · {post.author}
                </p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-700 group-hover:text-brand-900">
                  Read article
                  <ArrowRight aria-hidden="true" className="size-4" />
                </span>
              </article>
            </li>
          ))}
        </ul>
      </Container>
    </PageShell>
  );
}
