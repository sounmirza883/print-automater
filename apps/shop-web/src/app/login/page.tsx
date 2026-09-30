"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent, type ReactNode } from "react";
import { safeNextPath } from "@/lib/safe-next";

export default function LoginPage(): ReactNode {
  // useSearchParams() needs a Suspense boundary during static generation.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm(): ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const expired = searchParams.get("next") !== null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: unknown };
      if (!response.ok) {
        setError(
          typeof payload.message === "string" ? payload.message : "Incorrect email or password.",
        );
        return;
      }
      router.push(safeNextPath(searchParams.get("next")));
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
      <section
        aria-hidden="true"
        className="relative hidden overflow-hidden bg-side p-12 text-side-ink lg:flex lg:flex-col lg:justify-between"
      >
        <div className="flex items-center gap-3 text-white">
          <span className="grid size-9 place-items-center rounded-md bg-accent font-bold">PA</span>
          <span className="text-lg font-semibold tracking-tight">Print Automated</span>
        </div>
        <div className="max-w-md">
          <p className="text-3xl leading-tight font-semibold tracking-tight text-white">
            The whole floor, on one screen.
          </p>
          <p className="mt-4 text-base text-side-ink">
            Orders, printers, paper and people, with the things that need a human called out first.
          </p>
        </div>
        <p className="num text-xs tracking-widest text-side-ink/70 uppercase">
          Queue &middot; Printers &middot; Stock &middot; Reports
        </p>
      </section>

      <section className="flex flex-col justify-center gap-6 px-6 py-12 sm:px-12">
        <div className="lg:hidden">
          <span className="grid size-9 place-items-center rounded-md bg-accent font-bold text-white">
            PA
          </span>
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to your business</h1>
          <p className="mt-1 text-muted">
            {expired
              ? "Your session ended. Sign in again to pick up where you left off."
              : "For business owners, managers and staff."}
          </p>
        </div>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          <label htmlFor="email" className="flex flex-col gap-1 text-sm font-medium">
            Email
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded-md border border-line bg-panel px-3 py-2 text-base font-normal"
            />
          </label>
          <label htmlFor="password" className="flex flex-col gap-1 text-sm font-medium">
            Password
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-md border border-line bg-panel px-3 py-2 text-base font-normal"
            />
          </label>
          {error !== null && (
            <p
              role="alert"
              className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-danger-fg"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-accent px-4 py-2.5 font-semibold text-white disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="flex flex-col gap-2 text-sm text-muted">
          <p>
            New business owner with a code from us?{" "}
            <Link href="/set-up-account" className="font-medium text-accent underline">
              Set up your account
            </Link>
          </p>
          <p>
            Invited to a business?{" "}
            <Link href="/accept-invite" className="font-medium text-accent underline">
              Accept your invitation
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
