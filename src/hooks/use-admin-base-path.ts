"use client";

import { usePathname } from "next/navigation";

/**
 * Returns the admin base path based on the current route.
 * - `/school-admin` for SCHOOL_ADMIN users
 * - `/admin` for SUPER_ADMIN users
 *
 * Use this hook in shared page components that contain navigation links
 * so the same component works under both `/admin/...` and `/school-admin/...`.
 */
export function useAdminBasePath(): string {
  const pathname = usePathname();
  return pathname.startsWith("/school-admin") ? "/school-admin" : "/admin";
}
