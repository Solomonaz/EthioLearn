export interface AvatarPreset {
  id: string;
  emoji: string;
  bg: string; // Tailwind background color class
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "1",  emoji: "🦁", bg: "bg-amber-400"   },
  { id: "2",  emoji: "🐯", bg: "bg-orange-400"  },
  { id: "3",  emoji: "🦊", bg: "bg-red-400"     },
  { id: "4",  emoji: "🐺", bg: "bg-slate-400"   },
  { id: "5",  emoji: "🦅", bg: "bg-sky-400"     },
  { id: "6",  emoji: "🦋", bg: "bg-purple-400"  },
  { id: "7",  emoji: "🐬", bg: "bg-cyan-400"    },
  { id: "8",  emoji: "🦎", bg: "bg-green-400"   },
  { id: "9",  emoji: "🐉", bg: "bg-emerald-500" },
  { id: "10", emoji: "🦄", bg: "bg-pink-400"    },
  { id: "11", emoji: "🤖", bg: "bg-blue-400"    },
  { id: "12", emoji: "👑", bg: "bg-yellow-400"  },
];

export function getPreset(avatarUrl: string | null | undefined): AvatarPreset | null {
  if (!avatarUrl?.startsWith("preset:")) return null;
  const id = avatarUrl.slice(7); // "preset:3" → "3"
  return AVATAR_PRESETS.find((p) => p.id === id) ?? null;
}
