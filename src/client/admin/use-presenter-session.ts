import { useEffect, useRef, useState } from "react";
import type { AdminSessionDetail, PresenterAction } from "../../shared/contracts.js";
import { createSocket, type AppSocket } from "../socket.js";

export function usePresenterSession(
  session: AdminSessionDetail,
  onSnapshot: (snapshot: AdminSessionDetail) => void,
  onAuthExpired: () => void,
) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const socketRef = useRef<AppSocket | null>(null);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    const subscribe = () => {
      socket.emit(
        "session:subscribe",
        { joinName: session.joinName, role: "admin" },
        (result) => {
          if (result.ok && result.data.role === "admin") {
            onSnapshot(result.data);
            setError(null);
          } else if (!result.ok) {
            if (result.error.code === "admin_required") onAuthExpired();
            else setError(result.error.message);
          }
        },
      );
    };
    socket.on("connect", subscribe);
    socket.on("session:snapshot", (snapshot) => {
      if (snapshot.role === "admin") onSnapshot(snapshot);
    });
    socket.on("disconnect", (reason) => {
      if (reason === "io server disconnect") onAuthExpired();
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session.id, session.joinName, onAuthExpired, onSnapshot]);

  const command = (
    action: PresenterAction,
    options: { value?: boolean } = {},
  ) => {
    const socket = socketRef.current;
    if (!socket) return;
    setBusy(true);
    setError(null);
    socket.emit(
      "presenter:command",
      {
        requestId: crypto.randomUUID(),
        action,
        expectedControlRevision: session.controlRevision,
        value: options.value,
      },
      (result) => {
        setBusy(false);
        if (result.ok) {
          onSnapshot(result.data);
        } else {
          if (result.error.code === "admin_required") {
            onAuthExpired();
            return;
          }
          setError(result.error.message);
          socket.emit("session:snapshot", (fresh) => {
            if (fresh.ok && fresh.data.role === "admin") onSnapshot(fresh.data);
          });
        }
      },
    );
  };

  return { error, busy, command };
}
