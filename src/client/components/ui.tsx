import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";
import { Link } from "react-router";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={`brand${compact ? " brand--compact" : ""}`} to="/">
      <span className="brand__mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>Live Voting</span>
    </Link>
  );
}

export function Button({
  className = "",
  variant = "primary",
  static: isStatic = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  static?: boolean;
}) {
  return (
    <button
      className={`button button--${variant}${isStatic ? " button--static" : ""} ${className}`.trim()}
      {...props}
    />
  );
}

export function PageShell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`page-shell ${className}`.trim()}>{children}</div>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="center-state" role="status">
      <span className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="center-state center-state--error" role="alert">
      <span className="error-dot" aria-hidden="true" />
      <h1>Something went wrong</h1>
      <p>{message}</p>
      {action}
    </div>
  );
}

export function InlineNotice({
  children,
  tone = "info",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  tone?: "info" | "error" | "success";
}) {
  return (
    <div className={`notice notice--${tone}`} {...props}>
      {children}
    </div>
  );
}

export function StatusPill({ children }: { children: ReactNode }) {
  return <span className="status-pill">{children}</span>;
}
