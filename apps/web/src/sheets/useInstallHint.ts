import { useCallback, useEffect, useState } from "react";
import {
  dismissInstallHint,
  isStandaloneDisplay,
  readDismissed,
  readVisits,
  shouldShowInstallHint,
} from "../player/core/installHint";
import { safeLocalStorage } from "../player/core/resume";

/**
 * Whether to show the Add to Home Screen hint: Safari on iOS only, not installed, after two or more
 * visits, never again once dismissed. It decides after mount, so the server and the first client
 * render agree (nothing) and the hint appears without a hydration mismatch.
 */
export function useInstallHint(): { show: boolean; dismiss: () => void } {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const storage = safeLocalStorage();
    setShow(
      shouldShowInstallHint({
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
        isStandalone: isStandaloneDisplay(),
        dismissed: readDismissed(storage),
        visits: readVisits(storage),
      }),
    );
  }, []);

  const dismiss = useCallback(() => {
    dismissInstallHint(safeLocalStorage());
    setShow(false);
  }, []);

  return { show, dismiss };
}
