import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHero, PageShell, Prose } from "@/components/pages";
import { Button, Container } from "@/components/ui";
import {
  PLACEHOLDER_LABEL,
  blogPosts,
  formatPostDate,
  getPost,
  type PostBlock,
} from "@/content/blog";

type Params = { slug: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return blogPosts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.excerpt,
      publishedTime: post.date,
    },
  };
}

function renderBlock(block: PostBlock, i: number) {
  if (block.type === "h2") {
    return (
      <h2 key={i} id={block.id}>
        {block.text}
      </h2>
    );
  }
  if (block.type === "ul") {
    return (
      <ul key={i}>
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  return <p key={i}>{block.text}</p>;
}

export default async function BlogPostPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  return (
    <PageShell>
      <PageHero
        eyebrow={post.tag}
        title={post.title}
        lede={
          <>
            <time dateTime={post.date}>{formatPostDate(post.date)}</time> · {post.readMinutes} min
            read · {post.author}
          </>
        }
        crumbs={[
          { label: "Home", href: "/" },
          { label: "Blog", href: "/blog" },
          { label: post.title },
        ]}
      />
      <Container className="py-12 md:py-16">
        <article className="mx-auto max-w-2xl">
          <p
            role="note"
            className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          >
            {PLACEHOLDER_LABEL}
          </p>
          <Prose className="mt-2 text-lg leading-8 [&_h2]:text-2xl">
            {post.body.map(renderBlock)}
          </Prose>
          <footer className="mt-12 flex flex-col gap-3 border-t border-ink-100 pt-8 sm:flex-row sm:items-center">
            <Button href="/blog" variant="ghost">
              <ArrowLeft aria-hidden="true" className="size-4" />
              All articles
            </Button>
          </footer>
        </article>
      </Container>
    </PageShell>
  );
}
