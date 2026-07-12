import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function useJoinQrCode(joinName: string): string | null {
  const [qrCode, setQrCode] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setQrCode(null);
    void QRCode.toDataURL(`${window.location.origin}/${joinName}`, {
      width: 720,
      margin: 2,
      color: { dark: "#17221cff", light: "#ffffffff" },
      errorCorrectionLevel: "M",
    })
      .then((dataUrl) => {
        if (active) setQrCode(dataUrl);
      })
      .catch(() => {
        if (active) setQrCode(null);
      });
    return () => {
      active = false;
    };
  }, [joinName]);

  return qrCode;
}
