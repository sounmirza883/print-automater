"use client";

import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/ui";

/** Small form primitives shared by every management screen, so labels,
 * hints, invalid states and spacing are identical everywhere. */

export const INPUT = "rounded-md border border-line bg-panel px-2 py-1.5 text-sm font-normal";

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}): ReactNode {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      {children}
      {error ? (
        <span role="alert" className="text-xs font-normal text-danger-fg">
          {error}
        </span>
      ) : hint ? (
        <span className="text-xs font-normal text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  error,
  maxLength,
  type = "text",
  mono = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  maxLength?: number;
  type?: "text" | "email" | "tel";
  mono?: boolean;
  placeholder?: string;
}): ReactNode {
  return (
    <Field label={label} hint={hint} error={error}>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`${INPUT} ${mono ? "num" : ""}`}
      />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  hint,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  placeholder?: string;
}): ReactNode {
  return (
    <Field label={label} hint={hint} error={error}>
      <input
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`${INPUT} num`}
      />
    </Field>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  maxLength,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  rows?: number;
}): ReactNode {
  return (
    <Field label={label}>
      <textarea
        value={value}
        rows={rows}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className={INPUT}
      />
    </Field>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  emptyLabel,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  emptyLabel?: string;
  hint?: string;
}): ReactNode {
  return (
    <Field label={label} hint={hint}>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={INPUT}>
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
  hint,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
}): ReactNode {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5"
      />
      <span>
        <span className="font-medium">{label}</span>
        {hint !== undefined && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Search box that runs on submit (Enter / button), so typing never fires a
 * request per keystroke and never burns the 60-per-minute search budget. */
export function SearchForm({
  value,
  onChange,
  onSubmit,
  label,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  label: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <form
      role="search"
      className="mb-4 flex flex-wrap items-end gap-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="grid min-w-[14rem] flex-1 gap-1 text-xs font-medium text-muted">
        {label}
        <input
          type="search"
          value={value}
          maxLength={100}
          onChange={(event) => onChange(event.target.value)}
          className={`${INPUT} text-base text-ink`}
        />
      </label>
      {children}
      <Button type="submit" variant="primary">
        Search
      </Button>
    </form>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}): ReactNode {
  if (total <= pageSize) {
    return null;
  }
  return (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-sm">
      <Button disabled={page === 0} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className="num text-muted">
        {page * pageSize + 1}&ndash;{Math.min((page + 1) * pageSize, total)} of {total}
      </span>
      <Button disabled={(page + 1) * pageSize >= total} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </nav>
  );
}

export function ErrorBanner({ message }: { message: string | null }): ReactNode {
  if (message === null) {
    return null;
  }
  return (
    <p
      role="alert"
      className="mb-4 rounded-md border border-danger/50 bg-danger-soft px-3 py-2 text-danger-fg"
    >
      {message}
    </p>
  );
}
