import type { ComponentProps, ReactNode } from "react";

/**
 * Auth form primitives. Every value here comes from the token set in
 * globals.css — no ad hoc colours, radii, or type sizes.
 */

export function FormCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="bg-raised shadow-elev-1 w-full max-w-[400px] rounded-xl p-6">
      <h1 className="text-lg text-text font-bold tracking-[-0.015em]">{title}</h1>
      {description ? (
        <p className="text-xs text-text-secondary mt-2 leading-relaxed">
          {description}
        </p>
      ) : null}
      <div className="mt-5">{children}</div>
      {footer ? (
        <div className="text-xs text-text-secondary mt-5 leading-relaxed">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  name,
  hint,
  ...props
}: { label: string; name: string; hint?: string } & ComponentProps<"input">) {
  const hintId = hint ? `${name}-hint` : undefined;
  return (
    <label className="mb-4 block">
      <span className="text-sm text-text mb-1.5 block font-medium">{label}</span>
      <input
        name={name}
        id={name}
        aria-describedby={hintId}
        className="bg-bg text-text placeholder:text-text-tertiary focus:ring-accent w-full rounded-md px-3 py-2.5 text-base outline-none focus:ring-2"
        {...props}
      />
      {hint ? (
        <span id={hintId} className="text-2xs text-text-tertiary mt-1.5 block">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function SubmitButton({
  children,
  pending,
}: {
  children: ReactNode;
  pending?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-accent text-on-accent w-full cursor-pointer rounded-md px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
    >
      {pending ? "Working…" : children}
    </button>
  );
}

/** Errors use text weight rather than a red fill, matching the flat design. */
export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm mb-4 font-medium text-[oklch(65%_0.19_25)]">
      {children}
    </p>
  );
}

export function FormNotice({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="status" className="text-sm text-comment-text mb-4 leading-relaxed">
      {children}
    </p>
  );
}
