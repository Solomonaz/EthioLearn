import { FeatureGate } from "@/components/student/feature-gate";

/** The graphing calculator is a plan feature: a plan without it shows the locked screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="graphing">{children}</FeatureGate>;
}
