"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { INPUT_LG } from "@/components/form-kit";
import { rememberSelectedBusiness } from "@/components/session-provider";
import { Button, Notice } from "@/components/ui";

const MIN_PASSWORD = 8;

/** Fix wave 1: where the owner of a business a platform administrator created sets
 * their password. The email they got ("Your business is ready on Print Automated")
 * tells them to open the back office, choose "Set up your account" and enter their
 * email address with the code -- this page, reached from the sign-in page. Public on
 * purpose: the account has no password yet, so there is nothing to sign in with. The
 * server checks the code AND the address and every refusal reads the same. As on
 * accept-invite, the code is typed in, never taken from the URL, so it does not end up
 * in browser history or referrer headers. */
export default function SetUpAccountPage(): ReactNode {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    if (password.length < MIN_PASSWORD) {
      setError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: code.trim(), password }),
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
    <AuthFrame
      title="Set up your account"
      intro={
        <>
          For the owner of a business a Print Automated administrator has set up. Enter the email
          address the code was sent to and the code from that email, then choose your password. You
          are signed in straight away.
        </>
      }
      footer={
        <>
          <p>
            The code works for 7 days. If it has expired or never arrived, ask your Print Automated
            administrator to send a new one; only the newest code works.
          </p>
          <p>
            Already set your password?{" "}
            <Link href="/login" className="font-medium text-accent-fg underline">
              Sign in
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
            className={INPUT_LG}
          />
        </label>
        <label htmlFor="code" className="flex flex-col gap-1 text-sm font-medium">
          Code from the email
          <input
            id="code"
            name="code"
            type="text"
            autoComplete="one-time-code"
            spellCheck={false}
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className={`${INPUT_LG} num`}
          />
        </label>
        <label htmlFor="password" className="flex flex-col gap-1 text-sm font-medium">
          Choose a password
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={INPUT_LG}
          />
          <span className="text-xs font-normal text-muted">
            At least {MIN_PASSWORD} characters.
          </span>
        </label>
        <label htmlFor="confirm" className="flex flex-col gap-1 text-sm font-medium">
          Confirm password
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className={INPUT_LG}
          />
        </label>
        {error !== null && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        <Button type="submit" variant="primary" disabled={submitting} size="lg" className="w-full">
          {submitting ? "Setting up…" : "Set password and sign in"}
        </Button>
      </form>
    </AuthFrame>
  );
}
