import { cn } from "@/lib/utils";

type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "difficulty-easy"
  | "difficulty-medium"
  | "difficulty-hard";

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-gray-100 text-text-secondary",
  success: "bg-green-100 text-success",
  warning: "bg-yellow-100 text-warning",
  error: "bg-red-100 text-error",
  info: "bg-blue-100 text-info",
  "difficulty-easy": "bg-green-100 text-success",
  "difficulty-medium": "bg-yellow-100 text-warning",
  "difficulty-hard": "bg-red-100 text-error",
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({
  variant = "default",
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variantStyles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
