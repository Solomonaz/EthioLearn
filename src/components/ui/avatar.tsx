import { cn } from "@/lib/utils";
import { getPreset } from "@/lib/avatar-presets";

type AvatarSize = "sm" | "md" | "lg";

const sizeStyles: Record<AvatarSize, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
};

const bgColors = [
  "bg-primary",
  "bg-primary-light",
  "bg-info",
  "bg-success",
  "bg-warning",
  "bg-accent",
  "bg-secondary-dark",
];

function getColorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return bgColors[Math.abs(hash) % bgColors.length];
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  className?: string;
}

export function Avatar({ name, src, size = "md", className }: AvatarProps) {
  const preset = getPreset(src);
  if (preset) {
    return (
      <div
        className={cn(
          "rounded-full flex items-center justify-center text-white select-none",
          sizeStyles[size],
          preset.bg,
          className,
        )}
      >
        <span className="leading-none">{preset.emoji}</span>
      </div>
    );
  }

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn(
          "rounded-full object-cover",
          sizeStyles[size],
          className,
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-full font-semibold text-white",
        sizeStyles[size],
        getColorFromName(name),
        className,
      )}
    >
      {getInitials(name)}
    </div>
  );
}
