"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { rememberSelectedBusiness } from "@/components/session-provider";

const FIELD = "rounded-md border border-line bg-panel px-3 py-2 text-base font-normal";

/** 23.23: redeem an emailed invitation. Public on purpose: until they accept, an invitee
 * belongs to no business, so the ordinary sign-in refuses them. They sign in and give the
 * code here in one step; the server checks the code AND that this account's email is the
 * invited address, and every refusal reads the same. The code is typed in, never taken
 * from the URL, so it does not end up in browser history or referrer headers. */
export default function AcceptInvitePage(): ReactNode {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, code: code.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: unknown;
        shopId?: unknown;
      };
      if (!response.ok) {
        setError(
          typeof payload.message === "string"
            ? payload.message
            : "That did not work. Check the details and try again.",
        );
        return;
      }
      if (typeof payload.shopId === "string") {
        rememberSelectedBusiness(payload.shopId);
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section className="flex w-full max-w-md flex-col gap-6">
        <span className="grid size-9 place-items-center rounded-md bg-accent font-bold text-white">
          PA
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Accept an invitation</h1>
          <p className="mt-1 text-muted">
            Sign in with the email address the invitation was sent to, and enter the code from the
            email. You join the business with the role it offered.
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
              className={FIELD}
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
              className={FIELD}
            />
          </label>
          <label htmlFor="code" className="flex flex-col gap-1 text-sm font-medium">
            Invitation code
            <input
              id="code"
              name="code"
              type="text"
              autoComplete="one-time-code"
              spellCheck={false}
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className={`${FIELD} num`}
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
            {submitting ? "Joining…" : "Accept and sign in"}
          </button>
        </form>
        <div className="flex flex-col gap-2 text-sm text-muted">
          <p>
            No account yet? Create one on the customer site with the same email address, then come
            back here with your code. The code works for 7 days.
          </p>
          <p>
            Already part of the business?{" "}
            <Link href="/login" className="font-medium text-accent underline">
              Sign in
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
