"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  School,
  Plus,
  Trash2,
  Eye,
  Users,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { Badge } from "@/components/ui/badge";

interface SchoolAdmin {
  id: string;
  name: string;
}

interface SchoolItem {
  id: string;
  name: string;
  region: string;
  city: string;
  type: "PUBLIC" | "PRIVATE";
  _count?: {
    users: number;
  };
  admins?: SchoolAdmin[];
  createdAt: string;
}

export default function AdminSchoolsPage() {
  const { data: session } = useSession();
  const [schools, setSchools] = useState<SchoolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRegion, setNewRegion] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newType, setNewType] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchSchools = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/admin/schools");
      if (!res.ok) throw new Error("Failed to load schools");
      const data = await res.json();
      setSchools(data.schools ?? []);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSchools();
  }, [fetchSchools]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newRegion.trim() || !newCity.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          region: newRegion.trim(),
          city: newCity.trim(),
          type: newType,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create school");
      }

      toast.success("School created successfully!");
      setNewName("");
      setNewRegion("");
      setNewCity("");
      setNewType("PUBLIC");
      setShowForm(false);
      await fetchSchools();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Are you sure you want to delete this school?")) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/schools/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");

      setSchools((prev) => prev.filter((s) => s.id !== id));
      toast.success("School deleted.");
    } catch {
      toast.error("Failed to delete school.");
    } finally {
      setDeletingId(null);
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

  // Stats
  const totalStudents = schools.reduce(
    (sum, s) => sum + (s._count?.users ?? 0),
    0
  );
  const totalAdmins = schools.reduce(
    (sum, s) => sum + (s.admins?.length ?? 0),
    0
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            Manage Schools
          </h1>
          <p className="text-sm text-text-secondary">
            Create and manage schools across the platform.
          </p>
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Add School
        </Button>
      </div>

      {/* Stats Row */}
      {!loading && !fetchError && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <School className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-text-primary">
                  {schools.length}
                </p>
                <p className="text-xs text-text-secondary">Total Schools</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
                <Users className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold text-text-primary">
                  {totalStudents.toLocaleString()}
                </p>
                <p className="text-xs text-text-secondary">Total Students</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                <ShieldCheck className="h-5 w-5 text-info" />
              </div>
              <div>
                <p className="text-2xl font-bold text-text-primary">
                  {totalAdmins}
                </p>
                <p className="text-xs text-text-secondary">Total Admins</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add School Form (inline, like subjects page) */}
      {showForm && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-text-primary">
                Create New School
              </h2>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase text-text-muted">
                    School Name
                  </label>
                  <Input
                    placeholder="e.g. Addis Ababa Preparatory School"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase text-text-muted">
                    Region
                  </label>
                  <Input
                    placeholder="e.g. Addis Ababa"
                    value={newRegion}
                    onChange={(e) => setNewRegion(e.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase text-text-muted">
                    City
                  </label>
                  <Input
                    placeholder="e.g. Addis Ababa"
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase text-text-muted">
                    Type
                  </label>
                  <select
                    value={newType}
                    onChange={(e) =>
                      setNewType(e.target.value as "PUBLIC" | "PRIVATE")
                    }
                    disabled={submitting}
                    className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="PUBLIC">Public</option>
                    <option value="PRIVATE">Private</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" isLoading={submitting}>
                  Create School
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Schools List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <School className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-text-primary">Schools</h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchSchools}
              disabled={loading}
            >
              {loading ? <Spinner size="sm" /> : "Refresh"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="md" className="text-primary" />
            </div>
          ) : fetchError ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <XCircle className="h-8 w-8 text-error" />
              <p className="text-sm text-text-secondary">{fetchError}</p>
            </div>
          ) : schools.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <School className="h-10 w-10 text-text-muted" />
              <p className="text-sm text-text-secondary">
                No schools created yet.
              </p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left font-semibold text-text-secondary">
                        School Name
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-text-secondary">
                        Region
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-text-secondary">
                        City
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-text-secondary">
                        Type
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-text-secondary">
                        Students
                      </th>
                      <th className="px-4 py-3 text-left font-semibold text-text-secondary">
                        Admins
                      </th>
                      <th className="px-4 py-3 text-right font-semibold text-text-secondary">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {schools.map((school) => (
                      <tr
                        key={school.id}
                        className="transition-colors hover:bg-gray-50/60"
                      >
                        <td className="px-6 py-4">
                          <span className="font-medium text-text-primary">
                            {school.name}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-text-secondary">
                          {school.region}
                        </td>
                        <td className="px-4 py-4 text-text-secondary">
                          {school.city}
                        </td>
                        <td className="px-4 py-4">
                          <Badge
                            variant={
                              school.type === "PUBLIC" ? "success" : "info"
                            }
                          >
                            {school.type}
                          </Badge>
                        </td>
                        <td className="px-4 py-4 text-text-secondary">
                          {school._count?.users ?? 0}
                        </td>
                        <td className="px-4 py-4 text-text-secondary">
                          {school.admins?.length ?? 0}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <Link href={`/admin/schools/${school.id}`}>
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                View
                              </Button>
                            </Link>
                            <button
                              onClick={() => handleDelete(school.id)}
                              disabled={deletingId === school.id}
                              className="rounded-lg p-2 text-text-muted transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                            >
                              {deletingId === school.id ? (
                                <Spinner size="sm" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="space-y-3 p-4 md:hidden">
                {schools.map((school) => (
                  <div
                    key={school.id}
                    className="rounded-lg border border-border p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-text-primary">
                          {school.name}
                        </p>
                        <p className="text-xs text-text-secondary">
                          {school.region}, {school.city}
                        </p>
                      </div>
                      <Badge
                        variant={
                          school.type === "PUBLIC" ? "success" : "info"
                        }
                      >
                        {school.type}
                      </Badge>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex gap-3 text-xs text-text-secondary">
                        <span>{school._count?.users ?? 0} students</span>
                        <span>{school.admins?.length ?? 0} admins</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link href={`/admin/schools/${school.id}`}>
                          <Button size="sm" variant="outline">
                            View
                          </Button>
                        </Link>
                        <button
                          onClick={() => handleDelete(school.id)}
                          disabled={deletingId === school.id}
                          className="rounded-lg p-2 text-text-muted transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                        >
                          {deletingId === school.id ? (
                            <Spinner size="sm" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
