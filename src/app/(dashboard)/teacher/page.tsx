"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Swords, PencilRuler, Shuffle, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";

/** Teacher dashboard landing — entry points to the classroom games. */
export default function TeacherDashboardPage() {
  const { data: session } = useSession();
  const t = useTranslations("teacher");
  const name = session?.user?.name ?? "";

  const cards = [
    {
      href: "/teacher/games/tug",
      icon: Swords,
      title: t("tugTitle"),
      desc: t("tugDesc"),
      accent: "text-red-500",
      ready: true,
    },
    {
      href: "/teacher/games/create",
      icon: PencilRuler,
      title: t("createTitle"),
      desc: t("createDesc"),
      accent: "text-primary",
      ready: true,
    },
    {
      href: "/teacher/games/picker",
      icon: Shuffle,
      title: t("pickerTitle"),
      desc: t("pickerDesc"),
      accent: "text-amber-500",
      ready: true,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">{t("welcome", { name })}</h1>
      <p className="mt-2 text-text-secondary">{t("dashHint")}</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.href} href={card.href} className="group">
            <Card className="flex h-full flex-col p-5 transition-shadow hover:shadow-md">
              <card.icon className={`h-8 w-8 ${card.accent}`} />
              <h2 className="mt-3 text-lg font-bold text-text-primary">{card.title}</h2>
              <p className="mt-1 flex-1 text-sm text-text-secondary">{card.desc}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                {t("open")}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
