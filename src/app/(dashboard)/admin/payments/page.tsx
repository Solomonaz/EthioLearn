"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Receipt,
  Check,
  X,
  Eye,
  Plus,
  Pencil,
  Trash2,
  Save,
  Building2,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { formatMoney, billingIntervalLabel, type BillingInterval } from "@/lib/pricing";

interface PaymentRow {
  id: string;
  amount: number;
  currency: string;
  billingInterval: BillingInterval;
  methodLabel: string;
  transactionRef: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  receiptName: string | null;
  student: { id: string; name: string | null; phoneNumber: string | null };
  plan: { id: string; name: string };
}

interface Account {
  id: string;
  method: string;
  accountName: string;
  accountNumber: string;
  instructions: string | null;
  isActive: boolean;
  sortOrder: number;
}

const STATUS_VARIANT: Record<PaymentRow["status"], "success" | "warning" | "error"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "error",
};

export default function AdminPaymentsPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const [requests, setRequests] = useState<PaymentRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"PENDING" | "ALL">("PENDING");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [receiptView, setReceiptView] = useState<{ id: string; img: string | null; loading: boolean } | null>(null);
  const [rejecting, setRejecting] = useState<PaymentRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reqRes, accRes] = await Promise.all([
        fetch("/api/admin/payments"),
        fetch("/api/admin/payment-accounts"),
      ]);
      setRequests(reqRes.ok ? (await reqRes.json()).requests ?? [] : []);
      setAccounts(accRes.ok ? (await accRes.json()).accounts ?? [] : []);
    } catch {
      toast.error("Failed to load payments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function review(row: PaymentRow, action: "approve" | "reject", note?: string) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/payments/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Failed to update payment");
      }
      toast.success(action === "approve" ? "Payment approved — plan activated." : "Payment rejected.");
      setRejecting(null);
      setRejectNote("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function viewReceipt(row: PaymentRow) {
    setReceiptView({ id: row.id, img: null, loading: true });
    try {
      const res = await fetch(`/api/admin/payments/${row.id}`);
      const d = res.ok ? await res.json() : null;
      setReceiptView({ id: row.id, img: d?.request?.receiptData ?? null, loading: false });
    } catch {
      setReceiptView({ id: row.id, img: null, loading: false });
    }
  }

  if (role && role !== "SUPER_ADMIN") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-text-secondary">Access denied. Super Admin only.</p>
      </div>
    );
  }

  const shown = filter === "PENDING" ? requests.filter((r) => r.status === "PENDING") : requests;
  const pendingCount = requests.filter((r) => r.status === "PENDING").length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
          <Receipt className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Payments</h1>
          <p className="text-sm text-text-secondary">
            Review manual payments and manage the accounts students pay into.
          </p>
        </div>
      </div>

      {/* Payee accounts */}
      <PayeeAccounts accounts={accounts} onChange={load} />

      {/* Requests */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-text-primary">Payment requests</h2>
              {pendingCount > 0 && <Badge variant="warning">{pendingCount} pending</Badge>}
            </div>
            <div className="inline-flex rounded-lg border border-border bg-surface p-1">
              {(["PENDING", "ALL"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={
                    "rounded-md px-3 py-1.5 text-sm font-semibold transition " +
                    (filter === f ? "bg-primary text-white" : "text-text-secondary hover:text-text-primary")
                  }
                >
                  {f === "PENDING" ? "Pending" : "All"}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size="lg" className="text-primary" />
            </div>
          ) : shown.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-text-secondary">
              {filter === "PENDING" ? "No payments waiting for review." : "No payments yet."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Method / ref</th>
                    <th className="px-4 py-3">Receipt</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shown.map((r) => (
                    <tr key={r.id} className="align-top hover:bg-background/40">
                      <td className="px-4 py-3">
                        <p className="font-medium text-text-primary">{r.student.name ?? "—"}</p>
                        <p className="text-xs text-text-muted">{r.student.phoneNumber ?? ""}</p>
                        <p className="mt-0.5 text-[11px] text-text-muted">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-semibold text-text-primary">
                        {formatMoney(r.amount, r.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-text-primary">{r.plan.name}</span>
                        <p className="text-xs text-text-muted">
                          {billingIntervalLabel(r.billingInterval).replace(/^\//, "")}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-text-primary">{r.methodLabel}</p>
                        <p className="font-mono text-xs text-text-muted">{r.transactionRef}</p>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => viewReceipt(r)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-text-secondary transition hover:border-primary/40 hover:text-primary"
                        >
                          <Eye className="h-3.5 w-3.5" /> View
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                        {r.status === "REJECTED" && r.adminNote && (
                          <p className="mt-1 max-w-[160px] text-[11px] text-text-muted">{r.adminNote}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.status === "PENDING" ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              className="gap-1"
                              isLoading={busyId === r.id}
                              onClick={() => review(r, "approve")}
                            >
                              <Check className="h-3.5 w-3.5" /> Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 text-error hover:bg-red-50"
                              disabled={busyId === r.id}
                              onClick={() => {
                                setRejecting(r);
                                setRejectNote("");
                              }}
                            >
                              <X className="h-3.5 w-3.5" /> Reject
                            </Button>
                          </div>
                        ) : (
                          <p className="text-right text-xs text-text-muted">
                            {r.reviewedAt ? new Date(r.reviewedAt).toLocaleDateString() : ""}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Receipt viewer */}
      {receiptView && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setReceiptView(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl bg-surface p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-text-primary">Receipt</h3>
              <button
                onClick={() => setReceiptView(null)}
                className="rounded-lg p-1.5 text-text-muted hover:bg-border/50 hover:text-text-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {receiptView.loading ? (
              <div className="flex justify-center py-16">
                <Spinner size="lg" className="text-primary" />
              </div>
            ) : receiptView.img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={receiptView.img} alt="Payment receipt" className="w-full rounded-lg border border-border" />
            ) : (
              <p className="py-10 text-center text-sm text-text-secondary">Couldn’t load the receipt.</p>
            )}
          </div>
        </div>
      )}

      {/* Reject reason */}
      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-2xl">
            <h3 className="font-semibold text-text-primary">Reject payment</h3>
            <p className="mt-1 text-sm text-text-secondary">
              Rejecting {rejecting.student.name ?? "this student"}’s {formatMoney(rejecting.amount, rejecting.currency)}{" "}
              payment for {rejecting.plan.name}. Add a reason (shown to the student).
            </p>
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={3}
              placeholder="e.g. Transaction number not found"
              className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRejecting(null)} disabled={busyId === rejecting.id}>
                Cancel
              </Button>
              <Button
                className="bg-error text-white hover:bg-error/90"
                isLoading={busyId === rejecting.id}
                onClick={() => review(rejecting, "reject", rejectNote.trim() || undefined)}
              >
                Reject payment
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Payee accounts manager ──────────────────────────────────
interface AccountForm {
  id: string | null;
  method: string;
  accountName: string;
  accountNumber: string;
  instructions: string;
  isActive: boolean;
}

function blankAccount(): AccountForm {
  return { id: null, method: "", accountName: "", accountNumber: "", instructions: "", isActive: true };
}

function PayeeAccounts({ accounts, onChange }: { accounts: Account[]; onChange: () => void }) {
  const [editor, setEditor] = useState<AccountForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function save() {
    if (!editor) return;
    if (!editor.method.trim() || !editor.accountName.trim() || !editor.accountNumber.trim()) {
      toast.error("Method, account name and number are required.");
      return;
    }
    setSaving(true);
    try {
      const url = editor.id ? `/api/admin/payment-accounts/${editor.id}` : "/api/admin/payment-accounts";
      const res = await fetch(url, {
        method: editor.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: editor.method.trim(),
          accountName: editor.accountName.trim(),
          accountNumber: editor.accountNumber.trim(),
          instructions: editor.instructions.trim() || null,
          isActive: editor.isActive,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Failed to save account");
      }
      toast.success(editor.id ? "Account updated." : "Account added.");
      setEditor(null);
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(a: Account) {
    setBusyId(a.id);
    try {
      await fetch(`/api/admin/payment-accounts/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !a.isActive }),
      });
      onChange();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(a: Account) {
    if (!window.confirm(`Delete the ${a.method} account (${a.accountNumber})?`)) return;
    setBusyId(a.id);
    try {
      const res = await fetch(`/api/admin/payment-accounts/${a.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Account deleted.");
      onChange();
    } catch {
      toast.error("Failed to delete account.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <div>
              <h2 className="font-semibold text-text-primary">Payee accounts</h2>
              <p className="text-xs text-text-secondary">Accounts students pay into (Telebirr, CBE, BOA…).</p>
            </div>
          </div>
          {!editor && (
            <Button size="sm" className="gap-1.5" onClick={() => setEditor(blankAccount())}>
              <Plus className="h-4 w-4" /> New
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {editor && (
          <div className="space-y-3 rounded-xl border border-primary/40 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Method">
                <Input value={editor.method} onChange={(e) => setEditor({ ...editor, method: e.target.value })} placeholder="Telebirr" disabled={saving} />
              </Field>
              <Field label="Account name">
                <Input value={editor.accountName} onChange={(e) => setEditor({ ...editor, accountName: e.target.value })} placeholder="Solomon Azene" disabled={saving} />
              </Field>
              <Field label="Account number">
                <Input value={editor.accountNumber} onChange={(e) => setEditor({ ...editor, accountNumber: e.target.value })} placeholder="0923033733" disabled={saving} />
              </Field>
            </div>
            <Field label="Instructions (optional)">
              <Input value={editor.instructions} onChange={(e) => setEditor({ ...editor, instructions: e.target.value })} placeholder="e.g. Use your name as the payment note" disabled={saving} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={editor.isActive}
                onChange={(e) => setEditor({ ...editor, isActive: e.target.checked })}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              Active (shown to students)
            </label>
            <div className="flex gap-2">
              <Button onClick={save} isLoading={saving} className="gap-1.5">
                <Save className="h-4 w-4" /> {editor.id ? "Save" : "Add account"}
              </Button>
              <Button variant="ghost" onClick={() => setEditor(null)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {accounts.length === 0 && !editor ? (
          <p className="py-6 text-center text-sm text-text-secondary">
            No accounts yet. Add one so students can pay.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text-primary">{a.method}</span>
                    <Badge variant={a.isActive ? "success" : "default"}>{a.isActive ? "Active" : "Hidden"}</Badge>
                  </div>
                  <p className="text-sm text-text-secondary">
                    {a.accountName} · <span className="font-mono">{a.accountNumber}</span>
                  </p>
                  {a.instructions && <p className="text-xs text-text-muted">{a.instructions}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => toggle(a)} disabled={busyId === a.id}>
                    {a.isActive ? "Hide" : "Show"}
                  </Button>
                  <button
                    onClick={() =>
                      setEditor({
                        id: a.id,
                        method: a.method,
                        accountName: a.accountName,
                        accountNumber: a.accountNumber,
                        instructions: a.instructions ?? "",
                        isActive: a.isActive,
                      })
                    }
                    className="rounded-lg p-2 text-text-muted transition hover:bg-primary/10 hover:text-primary"
                    aria-label="Edit account"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => remove(a)}
                    disabled={busyId === a.id}
                    className="rounded-lg p-2 text-text-muted transition hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                    aria-label="Delete account"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase text-text-muted">{label}</label>
      {children}
    </div>
  );
}
