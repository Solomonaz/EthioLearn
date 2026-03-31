"use client";
import { Toaster as Sonner } from "sonner";
export { toast } from "sonner";
export function Toaster() {
  return (
    <Sonner
      richColors
      position="top-right"
      toastOptions={{
        classNames: {
          toast: "font-sans text-sm",
        },
      }}
    />
  );
}
