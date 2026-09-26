import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { translate } from "../i18n.js";

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    dialog.showModal();
    return () => dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="confirmation-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      <div className="confirmation-dialog__actions">
        <Button type="button" variant="secondary" autoFocus onClick={onCancel}>
          {translate("en", "cancel")}
        </Button>
        <Button type="button" variant={danger ? "danger" : "primary"} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      aria-label={compact ? "Live Voting home" : undefined}
      className={`brand${compact ? " brand--compact" : ""}`}
      to="/"
    >
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
