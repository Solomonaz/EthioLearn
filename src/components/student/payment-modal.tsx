"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  ChevronLeft,
  Copy,
  Check,
  UploadCloud,
  Info,
  CalendarClock,
  Wallet,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { formatMoney, type StudentBillingInterval } from "@/lib/pricing";

interface Account {
  id: string;
  method: string;
  accountName: string;
  accountNumber: string;
  instructions: string | null;
}

export interface PaymentPlan {
  id: string;
  name: string;
  currency: string;
  trialDays: number;
}

/**
 * Step 2 of the subscribe flow: the student pays off-platform to one of the
 * admin's accounts, then submits the transaction reference + a receipt image.
 * The submission becomes a PENDING payment an admin approves.
 */
export function PaymentModal({
  plan,
  interval,
  amount,
  onClose,
  onSubmitted,
}: {
  plan: PaymentPlan;
  interval: StudentBillingInterval;
  amount: number;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const [txnRef, setTxnRef] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ dataUrl: string; name: string; type: string; size: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/student/payments")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const accs: Account[] = d.accounts ?? [];
        setAccounts(accs);
        if (accs[0]) setSelectedAccountId(accs[0].id);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Lock background scroll + close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;

  function copy(acc: Account) {
    navigator.clipboard.writeText(acc.accountNumber).then(() => {
      setCopiedId(acc.id);
      setTimeout(() => setCopiedId((c) => (c === acc.id ? null : c)), 1800);
    });
  }

  function onFile(file: File | null | undefined) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      toast.error("Please upload an image (PNG or JPG).");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error("Receipt must be under 3 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error("Couldn't read that file.");
    reader.onload = () =>
      setReceipt({ dataUrl: String(reader.result), name: file.name, type: file.type, size: file.size });
    reader.readAsDataURL(file);
  }

  const canSubmit = agreed && txnRef.trim().length >= 3 && !!receipt && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/student/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          billingInterval: interval,
          transactionRef: txnRef.trim(),
          receiptData: receipt!.dataUrl,
          receiptName: receipt!.name,
          receiptType: receipt!.type,
          methodLabel: selectedAccount?.method ?? "Manual",
          agreedPolicy: agreed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to submit payment");
      toast.success("Payment submitted — an admin will review it shortly.");
      onSubmitted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl overflow-hidden rounded-2xl bg-surface shadow-2xl">
        {/* Header */}
        <div className="relative bg-gradient-to-r from-primary-dark to-primary px-6 py-5 text-white">
          <button
            onClick={onClose}
            aria-label="Back to plans"
            className="absolute left-4 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 text-sm font-medium text-white/85 transition hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" /> Back to plans
          </button>
          <div className="text-center">
            <h2 className="text-lg font-bold">Make Payment</h2>
            <div className="mt-1.5 flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/80">
              <span className="h-1.5 w-6 rounded-full bg-white/90" />
              <span className="h-1.5 w-6 rounded-full bg-white/90" />
              Step 2 of 2
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-lg p-1 text-white/85 transition hover:bg-white/15 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          {/* Plan summary */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <CalendarClock className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold text-text-primary">{plan.name}</p>
                <p className="text-xs text-text-secondary">
                  Billed{" "}
                  {interval === "MONTHLY" ? "monthly" : interval === "QUARTERLY" ? "every 3 months" : "yearly"}
                </p>
              </div>
            </div>
            <span className="text-lg font-extrabold text-primary">
              {formatMoney(amount, plan.currency)}
            </span>
          </div>

          {/* Fair Usage Policy */}
          <div className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3">
            <p className="flex items-start gap-2 text-sm text-text-secondary">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>
                <strong className="text-text-primary">Fair Usage Policy:</strong> This is a committed
                term — access runs until it ends, then returns to Free. Excessive or automated use is
                prohibited.
              </span>
            </p>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              I agree to the Fair Usage Policy
            </label>
          </div>

          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner size="md" className="text-primary" />
            </div>
          ) : accounts.length === 0 ? (
            <div className="rounded-xl border border-border bg-background/50 px-4 py-6 text-center text-sm text-text-secondary">
              No payment accounts are set up yet. Please contact the administrator to complete payment.
            </div>
          ) : (
            <>
              {/* Instructions */}
              <div className="rounded-xl border border-info/30 bg-info/5 px-4 py-3 text-sm text-text-secondary">
                Send your payment to the account below, then enter your transaction number and upload the
                receipt. Your plan activates once an admin confirms the payment.
              </div>

              {/* Accounts */}
              <div className="space-y-2">
                {accounts.map((acc) => {
                  const active = acc.id === selectedAccountId;
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => setSelectedAccountId(acc.id)}
                      className={
                        "w-full rounded-xl border p-3 text-left transition " +
                        (active ? "border-primary bg-primary/[0.05] ring-1 ring-primary/30" : "border-border hover:border-primary/40")
                      }
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Wallet className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-text-primary">{acc.method}</p>
                          <p className="truncate text-xs text-text-secondary">{acc.accountName}</p>
                        </div>
                        {active && <Check className="h-4 w-4 text-primary" />}
                      </div>
                      {active && (
                        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                          <span className="font-mono text-base font-bold tracking-wide text-text-primary">
                            {acc.accountNumber}
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              copy(acc);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white transition hover:bg-primary-dark"
                          >
                            {copiedId === acc.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            {copiedId === acc.id ? "Copied" : "Copy"}
                          </span>
                        </div>
                      )}
                      {active && acc.instructions && (
                        <p className="mt-1.5 text-xs text-text-muted">{acc.instructions}</p>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Transaction ref */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-text-primary">
                  Transaction number / reference <span className="text-error">*</span>
                </label>
                <input
                  value={txnRef}
                  onChange={(e) => setTxnRef(e.target.value)}
                  placeholder="e.g. your Telebirr transaction number"
                  maxLength={120}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* Receipt upload */}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-text-primary">
                  Upload receipt <span className="text-error">*</span>
                </label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
                {receipt ? (
                  <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/[0.05] p-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={receipt.dataUrl} alt="Receipt" className="h-12 w-12 rounded-lg border border-border object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-primary">{receipt.name}</p>
                      <p className="text-xs text-text-secondary">{Math.round(receipt.size / 1024)} KB</p>
                    </div>
                    <button
                      onClick={() => setReceipt(null)}
                      aria-label="Remove receipt"
                      className="rounded-lg p-1.5 text-text-muted transition hover:bg-border/50 hover:text-text-primary"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-background/50 px-4 py-6 text-text-secondary transition hover:border-primary/50 hover:text-primary"
                  >
                    <UploadCloud className="h-6 w-6" />
                    <span className="text-sm font-medium">Click to upload your receipt</span>
                    <span className="text-xs text-text-muted">PNG or JPG, up to 3 MB</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Sticky submit */}
        <div className="border-t border-border bg-surface p-4">
          <button
            onClick={submit}
            disabled={!canSubmit || accounts.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-border disabled:text-text-muted"
          >
            {submitting && <Spinner size="sm" className="text-white" />}
            {submitting ? "Submitting…" : `Submit ${formatMoney(amount, plan.currency)} for confirmation`}
          </button>
          {!canSubmit && accounts.length > 0 && !submitting && (
            <p className="mt-2 text-center text-xs text-warning">
              Agree to the policy, enter your transaction number and attach a receipt to continue.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
