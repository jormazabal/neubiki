import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadWorkspaceAppearance, saveWorkspaceAppearance } from "../../lib/api/workspaceAppearance";
import { applyNativeWorkspaceFrame, applyWorkspaceAppearance } from "../../lib/theme/workspaceTheme";
import { defaultWorkspaceAppearance, type WorkspaceAppearance } from "../../types/workspaceAppearance";

export function useWorkspaceAppearance() {
  const [value, setValue] = useState(defaultWorkspaceAppearance);
  const [status, setStatus] = useState<"loading" | "load-error" | "idle" | "saving" | "saved" | "error">("loading");
  const [readAttempt, retryRead] = useState(0);
  const current = useRef(defaultWorkspaceAppearance);
  const systemDark = useRef(window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const waiting = useRef<WorkspaceAppearance>();
  const writing = useRef(false);

  const drain = useCallback(async () => {
    if (writing.current) return;
    writing.current = true;
    try {
      while (waiting.current) {
        const snapshot = waiting.current;
        waiting.current = undefined;
        try {
          await saveWorkspaceAppearance(snapshot);
          if (!waiting.current) setStatus("saved");
        } catch {
          if (!waiting.current) setStatus("error");
        }
      }
    } finally {
      writing.current = false;
    }
  }, []);

  const enqueue = useCallback((next: WorkspaceAppearance) => {
    current.current = next;
    setValue(next);
    setStatus("saving");
    waiting.current = next;
    void drain();
  }, [drain]);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    void loadWorkspaceAppearance(systemDark.current).then(result => {
      if (!active) return;
      if (result.migrate) enqueue(result.value);
      else {
        current.current = result.value;
        setValue(result.value);
        setStatus("idle");
      }
    }, () => { if (active) setStatus("load-error"); });
    return () => { active = false; };
  }, [enqueue, readAttempt]);

  useLayoutEffect(() => applyWorkspaceAppearance(value), [value]);
  const { profile, primaryColor } = value;
  useLayoutEffect(() => applyNativeWorkspaceFrame(profile, primaryColor), [profile, primaryColor]);

  return {
    value,
    status,
    hasPending: () => writing.current || waiting.current !== undefined,
    change: (patch: Partial<WorkspaceAppearance>) => enqueue({ ...current.current, ...patch }),
    reset: () => enqueue(defaultWorkspaceAppearance),
    retry: () => status === "load-error" ? retryRead(n => n + 1) : enqueue(current.current),
  };
}

export type WorkspaceAppearanceController = ReturnType<typeof useWorkspaceAppearance>;
