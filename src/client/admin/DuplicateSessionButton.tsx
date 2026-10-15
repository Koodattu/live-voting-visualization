import { useId, useRef, useState } from "react";
import type { AdminSessionDetail, AdminSessionSummary } from "../../shared/contracts.js";
import { apiRequest } from "../api.js";
import { Button, InlineNotice } from "../components/ui.js";
import { translate } from "../i18n.js";

export function DuplicateSessionButton({
  session,
  onDuplicated,
  disabled = false,
}: {
  session: AdminSessionSummary;
  onDuplicated: (session: AdminSessionDetail) => void;
  disabled?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [joinName, setJoinName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const duplicate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const copy = await apiRequest<AdminSessionDetail>(
        `/api/admin/sessions/${session.id}/duplicate`,
        { method: "POST", body: JSON.stringify({ joinName }) },
      );
      dialogRef.current?.close();
      onDuplicated(copy);
    } catch (duplicateError) {
      setError(duplicateError instanceof Error
        ? duplicateError.message
        : translate("en", "duplicateFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        disabled={disabled}
        aria-label={`${translate("en", "duplicateToDraft")}: ${session.title} (/${session.joinName})`}
        onClick={() => {
          setJoinName("");
          setError(null);
          dialogRef.current?.showModal();
        }}
      >
        {translate("en", "duplicateToDraft")}
      </Button>
      <dialog
        ref={dialogRef}
        className="confirmation-dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCancel={(event) => { if (busy) event.preventDefault(); }}
      >
        <form onSubmit={(event) => { event.preventDefault(); void duplicate(); }}>
          <h2 id={titleId}>{translate("en", "duplicateSession")}</h2>
          <p><strong>{session.title}</strong> /{session.joinName}</p>
          <p id={descriptionId}>{translate("en", "duplicateSessionHelp")}</p>
          <label>
            <span>{translate("en", "newJoinName")}</span>
            <div className="slug-input">
              <span>/</span>
              <input
                autoFocus
                required
                minLength={3}
                maxLength={24}
                pattern="[a-z0-9\-]{3,24}"
                value={joinName}
                disabled={busy}
                onChange={(event) => setJoinName(event.target.value.toLowerCase())}
              />
            </div>
          </label>
          {error && <InlineNotice tone="error" role="alert">{error}</InlineNotice>}
          <div className="confirmation-dialog__actions">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => dialogRef.current?.close()}>
              {translate("en", "cancel")}
            </Button>
            <Button type="submit" disabled={busy || joinName.length < 3}>
              {translate("en", busy ? "duplicating" : "duplicateToDraft")}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
