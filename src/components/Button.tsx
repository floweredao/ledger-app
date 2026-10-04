import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export type ButtonProps = ComponentProps<"button"> & {
  readonly variant?: Variant;
  readonly size?: "md" | "sm";
  readonly icon?: LucideIcon;
  readonly block?: boolean;
};

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  block = false,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const classes = ["btn", `btn-${variant}`, size === "sm" ? "btn-sm" : "", block ? "btn-block" : "", className ?? ""];
  return (
    <button type={type} className={classes.filter(Boolean).join(" ")} {...rest}>
      {Icon ? <Icon aria-hidden="true" size={18} strokeWidth={2} /> : null}
      {children}
    </button>
  );
}

export type IconButtonProps = Omit<ComponentProps<"button">, "children" | "aria-label"> & {
  readonly label: string;
  readonly icon: LucideIcon;
};

export function IconButton({ label, icon: Icon, className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} className={["icon-btn", className ?? ""].join(" ").trim()} {...rest}>
      <Icon aria-hidden="true" size={20} strokeWidth={2} />
    </button>
  );
}
