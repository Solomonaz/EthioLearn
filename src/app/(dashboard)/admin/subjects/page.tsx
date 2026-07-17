"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, Plus, Trash2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";

interface Subject {
  id: string;
  name: string;
  createdAt: string;
}

export default function AdminSubjectsPage() {
  const t = useTranslations("admin");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchSubjects = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/subjects");
      if (!res.ok) throw new Error("Failed to load subjects");
      const data = await res.json();
      setSubjects(data.subjects ?? []);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSubjects();
  }, [fetchSubjects]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create subject");
      }

      toast.success("Subject added successfully!");
      setNewName("");
      await fetchSubjects();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Are you sure you want to delete this subject?")) return;

    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/subjects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      
      setSubjects((prev) => prev.filter((s) => s.id !== id));
      toast.success("Subject deleted.");
    } catch {
      toast.error("Failed to delete subject.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">{t("subjectsTitle")}</h1>
        <p className="text-sm text-text-secondary">
          {t("analyticsSubtitle")}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Add Subject Form */}
        <div className="md:col-span-1">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-primary" />
                <h2 className="font-semibold text-text-primary">Add Subject</h2>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAdd} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase text-text-muted">
                    Subject Name
                  </label>
                  <Input
                    placeholder="e.g. Computer Science"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    disabled={submitting}
                  />
                </div>
                <Button type="submit" className="w-full" isLoading={submitting}>
                  Add Subject
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Subjects List */}
        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" />
                  <h2 className="font-semibold text-text-primary">Existing Subjects</h2>
                </div>
                <Button variant="ghost" size="sm" onClick={fetchSubjects} disabled={loading}>
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
              ) : subjects.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <BookOpen className="h-10 w-10 text-text-muted" />
                  <p className="text-sm text-text-secondary">No subjects yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {subjects.map((subject) => (
                    <div
                      key={subject.id}
                      className="flex items-center justify-between px-6 py-4"
                    >
                      <span className="font-medium text-text-primary">{subject.name}</span>
                      <button
                        onClick={() => handleDelete(subject.id)}
                        disabled={deletingId === subject.id}
                        className="rounded-lg p-2 text-text-muted transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                      >
                        {deletingId === subject.id ? (
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
        </div>
      </div>
    </div>
  );
}
