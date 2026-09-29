"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAdminBasePath } from "@/hooks/use-admin-base-path";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { PlatformSettingsPanel } from "@/components/admin/platform-settings-panel";
import {
  Building2,
  Users,
  BookOpen,
  Gift,
  Calendar,
  User,
  Mail,
  Shield,
  Download,
  Library,
} from "lucide-react";

interface SchoolData {
  id: string;
  name: string;
  region: string;
  city: string;
  type: "PUBLIC" | "PRIVATE";
  subscriptionTier: string | null;
  createdAt: string;
  gameConfig?: {
    maxPlayersPerRoom: number;
    timePerQuestion: number;
    defaultDifficulty: "EASY" | "MEDIUM" | "HARD";
  };
  _count: {
    users: number;
    textbooks: number;
    rewards: number;
  };
}

interface UserData {
  name: string;
  email: string | null;
  role: string;
}

export default function AdminSettingsPage() {
  const t = useTranslations("admin");
  const tq = useTranslations("quiz");
  const tNav = useTranslations("nav");
  const basePath = useAdminBasePath();
  const [school, setSchool] = useState<SchoolData | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [type, setType] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");

  const [maxPlayersPerRoom, setMaxPlayersPerRoom] = useState(20);
  const [timePerQuestion, setTimePerQuestion] = useState(20);
  const [defaultDifficulty, setDefaultDifficulty] = useState<"EASY" | "MEDIUM" | "HARD">("MEDIUM");

  useEffect(() => {
    async function fetchData() {
      try {
        const [settingsRes, userRes] = await Promise.all([
          fetch("/api/admin/settings"),
          fetch("/api/auth/session"),
        ]);

        if (!settingsRes.ok) throw new Error("Failed to load settings");
        const settingsData = await settingsRes.json();

        // Super admins have no school of their own — this page shows them only
        // the platform-wide controls, so skip the school-scoped form entirely.
        if (settingsData.isSuperAdmin || !settingsData.school) {
          setIsSuperAdmin(!!settingsData.isSuperAdmin);
        } else {
          setSchool(settingsData.school);
          setName(settingsData.school.name);
          setRegion(settingsData.school.region);
          setCity(settingsData.school.city);
          setType(settingsData.school.type);

          if (settingsData.school.gameConfig) {
            setMaxPlayersPerRoom(settingsData.school.gameConfig.maxPlayersPerRoom);
            setTimePerQuestion(settingsData.school.gameConfig.timePerQuestion);
            setDefaultDifficulty(settingsData.school.gameConfig.defaultDifficulty);
          }
        }

        if (userRes.ok) {
          const userData = await userRes.json();
          if (userData?.user) {
            setCurrentUser(userData.user);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load settings");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, region, city, type,
          maxPlayersPerRoom, timePerQuestion, defaultDifficulty,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update settings");
      }

      const data = await res.json();
      setSchool((prev) => prev ? { ...prev, ...data.school } : prev);
      setSuccess(t("settingsSaved"));
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error && !school) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-error">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">{t("settingsTitle")}</h1>
        <p className="text-sm text-text-muted">{t("settingsSubtitle")}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-700">
          {success}
        </div>
      )}

      {/* Global AI / pricing kill-switches (SUPER_ADMIN only; self-hides otherwise) */}
      <PlatformSettingsPanel />

      {isSuperAdmin ? (
        /* Super admins have no school of their own — show only their account.
           Everything school-scoped lives under the Schools tab. */
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold text-text-primary">{t("adminAccount")}</h2>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <User className="h-4 w-4 text-text-muted" />
                <div>
                  <p className="text-xs text-text-muted">{t("adminName")}</p>
                  <p className="text-sm font-medium text-text-primary">{currentUser?.name ?? "N/A"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-text-muted" />
                <div>
                  <p className="text-xs text-text-muted">{t("adminEmail")}</p>
                  <p className="text-sm font-medium text-text-primary">{currentUser?.email ?? "N/A"}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Shield className="h-4 w-4 text-text-muted" />
                <div>
                  <p className="text-xs text-text-muted">{t("adminRole")}</p>
                  <Badge variant="info">{currentUser?.role ?? "N/A"}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold text-text-primary">{tNav("schools")}</h2>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-text-secondary">
                As a super admin you manage every school individually — their info, game settings,
                students and textbooks — from the Schools tab.
              </p>
              <Link href={`${basePath}/schools`}>
                <Button variant="outline" className="w-full justify-start gap-2">
                  <Building2 className="h-4 w-4" />
                  {tNav("schools")}
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      ) : (
      <div className="grid gap-6 lg:grid-cols-2">
        {/* School Info Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-text-primary">{t("schoolInfoTitle")}</h2>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label={t("schoolNameLabel")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("schoolNamePlaceholder")}
            />
            <Input
              label={t("regionLabel")}
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder={t("regionPlaceholder")}
            />
            <Input
              label={t("cityLabel")}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder={t("cityPlaceholder")}
            />
            <div className="w-full">
              <label
                htmlFor="school-type"
                className="mb-2 block text-sm font-medium text-text-primary"
              >
                {t("schoolTypeLabel")}
              </label>
              <select
                id="school-type"
                value={type}
                onChange={(e) => setType(e.target.value as "PUBLIC" | "PRIVATE")}
                className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="PUBLIC">{t("publicType")}</option>
                <option value="PRIVATE">{t("privateType")}</option>
              </select>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleSave} isLoading={saving}>
              {t("saveChanges")}
            </Button>
          </CardFooter>
        </Card>

        {/* Game & Quiz Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-text-primary">{t("gameSettingsTitle")}</h2>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-text-primary">{t("timePerQuestion")}</label>
              <div className="flex items-center gap-2">
                <Spinner className="hidden" />
                <Input
                  type="number"
                  value={timePerQuestion}
                  onChange={(e) => setTimePerQuestion(parseInt(e.target.value) || 20)}
                  min={5}
                  max={60}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-text-primary">{t("maxPlayersPerRoom")}</label>
              <Input
                type="number"
                value={maxPlayersPerRoom}
                onChange={(e) => setMaxPlayersPerRoom(parseInt(e.target.value) || 20)}
                min={2}
                max={100}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-text-primary">{t("defaultQuizDifficulty")}</label>
              <select
                value={defaultDifficulty}
                onChange={(e) => setDefaultDifficulty(e.target.value as any)}
                className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary focus:border-primary outline-none"
              >
                <option value="EASY">{tq("easy")}</option>
                <option value="MEDIUM">{tq("medium")}</option>
                <option value="HARD">{tq("hard")}</option>
              </select>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleSave} isLoading={saving} className="w-full">
              {t("saveGameSettings")}
            </Button>
          </CardFooter>
        </Card>

        {/* School Stats Card */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-text-primary">{t("schoolStats")}</h2>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-blue-50 p-4">
                <div className="flex items-center gap-2 text-blue-600">
                  <Users className="h-4 w-4" />
                  <span className="text-sm font-medium">{t("colStudents")}</span>
                </div>
                <p className="mt-1 text-2xl font-bold text-blue-700">
                  {school?._count.users ?? 0}
                </p>
              </div>
              <div className="rounded-lg bg-green-50 p-4">
                <div className="flex items-center gap-2 text-green-600">
                  <BookOpen className="h-4 w-4" />
                  <span className="text-sm font-medium">{t("textbooks")}</span>
                </div>
                <p className="mt-1 text-2xl font-bold text-green-700">
                  {school?._count.textbooks ?? 0}
                </p>
              </div>
              <div className="rounded-lg bg-purple-50 p-4">
                <div className="flex items-center gap-2 text-purple-600">
                  <Gift className="h-4 w-4" />
                  <span className="text-sm font-medium">{t("quickRewards")}</span>
                </div>
                <p className="mt-1 text-2xl font-bold text-purple-700">
                  {school?._count.rewards ?? 0}
                </p>
              </div>
              <div className="rounded-lg bg-amber-50 p-4">
                <div className="flex items-center gap-2 text-amber-600">
                  <Calendar className="h-4 w-4" />
                  <span className="text-sm font-medium">{t("createdLabel")}</span>
                </div>
                <p className="mt-1 text-sm font-bold text-amber-700">
                  {school?.createdAt
                    ? new Date(school.createdAt).toLocaleDateString()
                    : "N/A"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Admin Account Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-text-primary">{t("adminAccount")}</h2>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <User className="h-4 w-4 text-text-muted" />
              <div>
                <p className="text-xs text-text-muted">{t("adminName")}</p>
                <p className="text-sm font-medium text-text-primary">
                  {currentUser?.name ?? "N/A"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-text-muted" />
              <div>
                <p className="text-xs text-text-muted">{t("adminEmail")}</p>
                <p className="text-sm font-medium text-text-primary">
                  {currentUser?.email ?? "N/A"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Shield className="h-4 w-4 text-text-muted" />
              <div>
                <p className="text-xs text-text-muted">{t("adminRole")}</p>
                <Badge variant="info">
                  {currentUser?.role ?? "N/A"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions Card */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-text-primary">{t("quickActions")}</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={() => alert("Coming soon")}
            >
              <Download className="h-4 w-4" />
              {t("exportStudentData")}
            </Button>
            <Link href={`${basePath}/textbooks`}>
              <Button variant="outline" className="w-full justify-start gap-2">
                <Library className="h-4 w-4" />
                {t("manageTextbooks")}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
      )}
    </div>
  );
}
