import { FeatureGate } from "@/components/student/feature-gate";

/** The 3D geometry lab is a plan feature: a plan without it shows the locked screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="geometry3d">{children}</FeatureGate>;
}
