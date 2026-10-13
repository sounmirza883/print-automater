"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent, type ReactNode } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { INPUT_LG } from "@/components/form-kit";
import { Notice } from "@/components/ui";
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
    <AuthFrame
      title="Sign in to your business"
      intro={
        expired
          ? "Your session ended. Sign in again to pick up where you left off."
          : "For business owners, managers and staff."
      }
      footer={
        <>
          <p>
            New business owner with a code from us?{" "}
            <Link href="/set-up-account" className="font-medium text-accent-fg underline">
              Set up your account
            </Link>
          </p>
          <p>
            Invited to a business?{" "}
            <Link href="/accept-invite" className="font-medium text-accent-fg underline">
              Accept your invitation
            </Link>
          </p>
        </>
      }
    >
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
            suppressHydrationWarning
            className={INPUT_LG}
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
            suppressHydrationWarning
            className={INPUT_LG}
          />
        </label>
        {error !== null && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        <button
          type="submit"
          disabled={submitting}
          suppressHydrationWarning
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-inv px-4 font-semibold text-inv-ink hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthFrame>
  );
}
