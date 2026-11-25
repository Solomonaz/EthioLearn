import { FeatureGate } from "@/components/student/feature-gate";

/** National exam practice is a plan feature: a plan without it shows the locked screen. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="nationalExam">{children}</FeatureGate>;
}
