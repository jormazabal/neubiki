import { forwardRef, type ComponentPropsWithoutRef } from "react";

type Props = ComponentPropsWithoutRef<"button"> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "compact" | "regular" | "icon";
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button({
  variant = "secondary", size = "regular", className = "", type = "button", ...props
}, ref) {
  return <button {...props} ref={ref} type={type} className={`ui-button ${className}`}
    data-variant={variant} data-size={size} />;
});
