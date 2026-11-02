"use client";
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useEffect, useId, useRef, useState } from "react";

// Editable UI starting points, using the optional DESIGN.md classes and tokens.

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  return (
    <button
      type="button"
      {...props}
      className={`button-${variant} min-h-11 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent ${className}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Field({
  label,
  id,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      <input
        id={id}
        {...props}
        className={`input focus-visible:outline-2 focus-visible:outline-accent ${className}`}
      />
    </div>
  );
}

/** Editable empty-state composition. Offer the next useful action when there is one. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <Card className="flex flex-col items-start gap-3">
      <p className="weight-label">{title}</p>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      {action && (
        <Button variant="primary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </Card>
  );
}

export function Badge({ children, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className={`inline-flex items-center rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium ${props.className ?? ""}`}
    >
      {children}
    </span>
  );
}
export function Alert({
  title,
  children,
  tone = "info",
}: {
  title: string;
  children?: ReactNode;
  tone?: "info" | "error" | "success";
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-lg border border-line bg-surface p-4 ${tone === "error" ? "text-danger" : "text-fg"}`}
    >
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm">{children}</div>}
    </div>
  );
}
export function Textarea({
  label,
  id,
  hint,
  error,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  id: string;
  hint?: string;
  error?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        {...props}
        id={id}
        aria-invalid={!!error}
        aria-describedby={hint || error ? `${id}-help` : undefined}
        className={`input min-h-28 focus-visible:outline-2 focus-visible:outline-accent ${props.className ?? ""}`}
      />
      {(hint || error) && (
        <p id={`${id}-help`} className={`text-sm ${error ? "text-danger" : "text-muted"}`}>
          {error || hint}
        </p>
      )}
    </div>
  );
}
export function Select({
  label,
  id,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; id: string }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        {...props}
        id={id}
        className={`input min-h-11 focus-visible:outline-2 focus-visible:outline-accent ${props.className ?? ""}`}
      >
        {children}
      </select>
    </div>
  );
}
export function Switch({
  label,
  id,
  checked,
  defaultChecked = false,
  onChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string; id: string }) {
  const [local, setLocal] = useState(defaultChecked);
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3">
      <input
        {...props}
        id={id}
        type="checkbox"
        role="switch"
        checked={checked ?? local}
        aria-checked={checked ?? local}
        onChange={(event) => {
          setLocal(event.currentTarget.checked);
          onChange?.(event);
        }}
        className="h-5 w-5 accent-accent focus-visible:outline-2 focus-visible:outline-accent"
      />
      <span>{label}</span>
    </label>
  );
}
export function Skeleton({
  label = "Loading",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      className={`motion-safe:animate-pulse rounded-lg bg-line ${className}`}
    >
      <span className="sr-only">{label}</span>
    </div>
  );
}
export function Progress({ value, label }: { value: number; label: string }) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      <progress id={id} value={value} max={100} className="h-2 w-full accent-accent">
        {value}%
      </progress>
    </div>
  );
}
export function Accordion({
  title,
  children,
  open,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details open={open} className="border-b border-line py-4">
      <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-accent">
        {title}
      </summary>
      <div className="pt-3 text-muted">{children}</div>
    </details>
  );
}
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    else if (!open && node.open) node.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby={titleId}
      className="fixed inset-0 m-auto max-h-[85dvh] w-[min(92vw,36rem)] overflow-auto rounded-xl border border-line bg-surface p-6 text-fg shadow-2xl backdrop:bg-black/40"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <h2 id={titleId} className="text-xl font-semibold">
          {title}
        </h2>
        <Button aria-label="Close dialog" onClick={onClose}>
          �
        </Button>
      </div>
      {children}
    </dialog>
  );
}
export function Tabs({
  items,
  label,
}: {
  label: string;
  items: readonly { id: string; label: string; content: ReactNode }[];
}) {
  const [selected, setSelected] = useState(items[0]?.id ?? "");
  const prefix = useId();
  const current = items.some((item) => item.id === selected) ? selected : items[0]?.id;
  return (
    <div>
      <div role="tablist" aria-label={label} className="flex gap-1 border-b border-line">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${prefix}-${item.id}`}
            aria-controls={`${prefix}-${item.id}-panel`}
            aria-selected={current === item.id}
            tabIndex={current === item.id ? 0 : -1}
            onClick={() => setSelected(item.id)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % items.length
                  : event.key === "ArrowLeft"
                    ? (index + items.length - 1) % items.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? items.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              const target = items[next];
              if (!target) return;
              setSelected(target.id);
              document.getElementById(`${prefix}-${target.id}`)?.focus();
            }}
            className="min-h-11 border-b-2 border-transparent px-4 py-2 text-muted aria-selected:border-accent aria-selected:text-fg focus-visible:outline-2 focus-visible:outline-accent"
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          id={`${prefix}-${item.id}-panel`}
          role="tabpanel"
          aria-labelledby={`${prefix}-${item.id}`}
          hidden={current !== item.id}
          className="py-5 focus-visible:outline-2 focus-visible:outline-accent"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
export function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-left text-sm [&_th]:border-b [&_th]:border-line [&_th]:bg-surface [&_th]:p-3 [&_td]:border-b [&_td]:border-line [&_td]:p-3">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
export function Avatar({ name, src }: { name: string; src?: string }) {
  return src ? (
    <img
      src={src}
      alt={name}
      width={40}
      height={40}
      className="h-10 w-10 rounded-full object-cover"
    />
  ) : (
    <span
      role="img"
      aria-label={name}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-fg"
    >
      {name
        .split(/\s+/u)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")}
    </span>
  );
}
/** Run pramaan design <look> --section <name> to add scoped variables/materials to theme.css. */
export function StyleScope({
  name,
  children,
  className = "",
  style,
}: {
  name: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section data-pramaan-style={name} style={style} className={`bg-bg text-fg ${className}`}>
      {children}
    </section>
  );
}
