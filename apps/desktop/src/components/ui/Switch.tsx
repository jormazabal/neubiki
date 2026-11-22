import type { ComponentPropsWithoutRef, ReactNode } from "react";

export function Switch({ children, ...input }: Omit<ComponentPropsWithoutRef<"input">, "type" | "role" | "children"> & {
  children: ReactNode;
}) {
  return <label className="ui-switch">
    <span>{children}</span>
    <input {...input} className="sr-only" type="checkbox" role="switch" />
    <span className="ui-switch-track" aria-hidden="true" />
  </label>;
}
