import { cn } from "@/lib/utils";

type ProgressColor = "primary" | "secondary" | "success";
type ProgressSize = "sm" | "md";

const colorStyles: Record<ProgressColor, string> = {
  primary: "bg-primary",
  secondary: "bg-secondary",
  success: "bg-success",
};

const sizeStyles: Record<ProgressSize, string> = {
  sm: "h-1.5",
  md: "h-3",
};

interface ProgressBarProps {
  value: number;
  color?: ProgressColor;
  size?: ProgressSize;
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  color = "primary",
  size = "md",
  showLabel = false,
  className,
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className={cn("w-full", className)}>
      {showLabel && (
        <div className="mb-1 text-right text-xs font-medium text-text-secondary">
          {Math.round(clamped)}%
        </div>
      )}
      <div
        className={cn(
          "w-full overflow-hidden rounded-full bg-gray-200",
          sizeStyles[size],
        )}
      >
        <div
          className={cn(
            "rounded-full transition-all duration-500 ease-out",
            sizeStyles[size],
            colorStyles[color],
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
