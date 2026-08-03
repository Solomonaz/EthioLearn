"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  ArrowLeft,
  Pencil,
  Save,
  X,
  Users,
  BookOpen,
  Gift,
  ShieldCheck,
  Trash2,
  Plus,
  UserPlus,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { Badge } from "@/components/ui/badge";
import { SubscriptionPanel } from "@/components/admin/subscription-panel";

interface SchoolAdmin {
  id: string;
  name: string;
  phoneNumber?: string;
  email?: string;
  createdAt: string;
}

interface SchoolDetail {
  id: string;
  name: string;
  region: string;
  city: string;
  type: "PUBLIC" | "PRIVATE";
  createdAt: string;
  admins: SchoolAdmin[];
  _count?: {
    users: number;
    textbooks: number;
    rewards: number;
  };
}

export default function SchoolDetailPage() {
  const params = useParams();
  const schoolId = params.id as string;
  const { data: session } = useSession();

  const [school, setSchool] = useState<SchoolDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editRegion, setEditRegion] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editType, setEditType] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [saving, setSaving] = useState(false);

  // Add admin
  const [adminMode, setAdminMode] = useState<"create" | "assign">("create");
  const [adminName, setAdminName] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [adminUserId, setAdminUserId] = useState("");
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [removingAdminId, setRemovingAdminId] = useState<string | null>(null);

  const fetchSchool = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/admin/schools/${schoolId}`);
      if (!res.ok) throw new Error("Failed to load school details");
      const data = await res.json();
      setSchool(data.school ?? null);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    fetchSchool();
  }, [fetchSchool]);

  // Populate edit fields when entering edit mode
  function startEditing() {
    if (!school) return;
    setEditName(school.name);
    setEditRegion(school.region);
    setEditCity(school.city);
    setEditType(school.type);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
  }

  async function handleSave() {
    if (!editName.trim() || !editRegion.trim() || !editCity.trim()) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/schools/${schoolId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          region: editRegion.trim(),
          city: editCity.trim(),
          type: editType,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to update school");
      }

      toast.success("School updated successfully!");
      setEditing(false);
      await fetchSchool();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddAdmin(e: React.FormEvent) {
    e.preventDefault();

    if (adminMode === "create" && (!adminName.trim() || !adminPhone.trim())) {
      toast.error("Please fill in name and phone number.");
      return;
    }
    if (adminMode === "assign" && !adminUserId.trim()) {
      toast.error("Please enter a user ID.");
      return;
    }

    setAddingAdmin(true);
    try {
      // The "+251" shown in the form is a fixed label — prepend it before
      // sending. Normalise so a pasted 0912…, 251912…, or +251912… also works:
      // keep digits only, then strip a leading country code (251) or trunk 0.
      const localDigits = adminPhone
        .trim()
        .replace(/\D/g, "")
        .replace(/^251/, "")
        .replace(/^0/, "");
      const body =
        adminMode === "create"
          ? { name: adminName.trim(), phoneNumber: `+251${localDigits}` }
          : { userId: adminUserId.trim() };

      const res = await fetch(`/api/admin/schools/${schoolId}/admins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to add administrator");
      }

      toast.success("Administrator added successfully!");
      setAdminName("");
      setAdminPhone("");
      setAdminUserId("");
      await fetchSchool();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setAddingAdmin(false);
    }
  }

  async function handleRemoveAdmin(userId: string) {
    if (
      !window.confirm(
        "Are you sure you want to remove this administrator?"
      )
    )
      return;

    setRemovingAdminId(userId);
    try {
      const res = await fetch(
        `/api/admin/schools/${schoolId}/admins/${userId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Remove failed");

      toast.success("Administrator removed.");
      await fetchSchool();
    } catch {
      toast.error("Failed to remove administrator.");
    } finally {
      setRemovingAdminId(null);
    }
  }

  // Access check
  if ((session?.user as any)?.role !== "SUPER_ADMIN") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-text-secondary">Access denied. Super Admin only.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    );
  }

  if (fetchError || !school) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <Link
          href="/admin/schools"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Schools
        </Link>
        <div className="flex flex-col items-center gap-3 py-10">
          <XCircle className="h-8 w-8 text-error" />
          <p className="text-sm text-text-secondary">
            {fetchError ?? "School not found."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/schools"
            className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Schools
          </Link>
        </div>
        {!editing ? (
          <Button variant="outline" onClick={startEditing} className="gap-1.5">
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button onClick={handleSave} isLoading={saving} className="gap-1.5">
              <Save className="h-4 w-4" />
              Save
            </Button>
            <Button variant="ghost" onClick={cancelEditing}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* School Info Card */}
      <Card>
        <CardHeader>
          <h1 className="text-xl font-bold text-text-primary">
            {editing ? "Edit School" : school.name}
          </h1>
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-text-muted">
                  School Name
                </label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-text-muted">
                  Region
                </label>
                <Input
                  value={editRegion}
                  onChange={(e) => setEditRegion(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-text-muted">
                  City
                </label>
                <Input
                  value={editCity}
                  onChange={(e) => setEditCity(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-text-muted">
                  Type
                </label>
                <select
                  value={editType}
                  onChange={(e) =>
                    setEditType(e.target.value as "PUBLIC" | "PRIVATE")
                  }
                  disabled={saving}
                  className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="PUBLIC">Public</option>
                  <option value="PRIVATE">Private</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase text-text-muted">
                  Region
                </p>
                <p className="mt-1 text-sm text-text-primary">{school.region}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-text-muted">
                  City
                </p>
                <p className="mt-1 text-sm text-text-primary">{school.city}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-text-muted">
                  Type
                </p>
                <div className="mt-1">
                  <Badge
                    variant={school.type === "PUBLIC" ? "success" : "info"}
                  >
                    {school.type}
                  </Badge>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-text-muted">
                  Created
                </p>
                <p className="mt-1 text-sm text-text-primary">
                  {new Date(school.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats Row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-text-primary">
                {school._count?.users ?? 0}
              </p>
              <p className="text-xs text-text-secondary">Students</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
              <BookOpen className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold text-text-primary">
                {school._count?.textbooks ?? 0}
              </p>
              <p className="text-xs text-text-secondary">Textbooks</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-100">
              <Gift className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold text-text-primary">
                {school._count?.rewards ?? 0}
              </p>
              <p className="text-xs text-text-secondary">Rewards</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Subscription */}
      <SubscriptionPanel audience="SCHOOL" targetId={school.id} />

      {/* School Administrators */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-text-primary">
              School Administrators
            </h2>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {school.admins.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <ShieldCheck className="h-10 w-10 text-text-muted" />
              <p className="text-sm text-text-secondary">
                No administrators assigned yet.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {school.admins.map((admin) => (
                <div
                  key={admin.id}
                  className="flex items-center justify-between px-6 py-4"
                >
                  <div>
                    <p className="font-medium text-text-primary">
                      {admin.name}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {admin.phoneNumber || admin.email || "No contact info"}
                      {" \u00b7 "}
                      Joined {new Date(admin.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRemoveAdmin(admin.id)}
                    disabled={removingAdminId === admin.id}
                    className="rounded-lg p-2 text-text-muted transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                  >
                    {removingAdminId === admin.id ? (
                      <Spinner size="sm" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Administrator Form */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            <h2 className="font-semibold text-text-primary">
              Add Administrator
            </h2>
          </div>
        </CardHeader>
        <CardContent>
          {/* Mode Toggle */}
          <div className="mb-4 flex gap-2">
            <Button
              variant={adminMode === "create" ? "primary" : "outline"}
              size="sm"
              onClick={() => setAdminMode("create")}
            >
              Create New
            </Button>
            <Button
              variant={adminMode === "assign" ? "primary" : "outline"}
              size="sm"
              onClick={() => setAdminMode("assign")}
            >
              Assign Existing
            </Button>
          </div>

          <form onSubmit={handleAddAdmin} className="space-y-4">
            {adminMode === "create" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase text-text-muted">
                    Full Name
                  </label>
                  <Input
                    placeholder="e.g. Abebe Kebede"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    disabled={addingAdmin}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase text-text-muted">
                    Phone Number
                  </label>
                  <div className="flex">
                    <span className="inline-flex items-center rounded-l-lg border border-r-0 border-border bg-gray-50 px-3 text-sm text-text-secondary">
                      +251
                    </span>
                    <Input
                      placeholder="9XXXXXXXX"
                      value={adminPhone}
                      onChange={(e) => setAdminPhone(e.target.value)}
                      disabled={addingAdmin}
                      className="rounded-l-none"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-text-muted">
                  User ID
                </label>
                <Input
                  placeholder="Enter existing user ID"
                  value={adminUserId}
                  onChange={(e) => setAdminUserId(e.target.value)}
                  disabled={addingAdmin}
                />
                <p className="text-xs text-text-muted">
                  The user will be assigned the SCHOOL_ADMIN role for this
                  school.
                </p>
              </div>
            )}

            <Button type="submit" isLoading={addingAdmin} className="gap-1.5">
              <Plus className="h-4 w-4" />
              {adminMode === "create"
                ? "Create & Assign Admin"
                : "Assign Admin"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
