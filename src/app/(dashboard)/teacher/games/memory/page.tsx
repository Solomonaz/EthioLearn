"use client";

import { NumberMemory } from "@/components/teacher/number-memory/number-memory";

/** Number Memory — memorise-then-recall trainer for the classroom screen. */
export default function NumberMemoryPage() {
  return (
    <div className="mx-auto h-[calc(100vh-8rem)] max-w-4xl">
      <NumberMemory />
    </div>
  );
}
