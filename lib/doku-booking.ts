import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/utils/supabase/admin";

export const DOKU_BOOKING_WEBHOOK_PATH = "/api/payment/doku/webhook";
export const isDokuBookingInvoice = (value: string) => /^DOKUBK[a-f0-9]{24}$/.test(value);
export const createDokuBookingInvoice = () => `DOKUBK${randomUUID().replace(/-/g, "").slice(0, 24)}`;

export function getDokuBookingUrls(requestUrl: string) {
  if (!process.env.DOKU_PRODUCTION_CLIENT_ID || !process.env.DOKU_PRODUCTION_SECRET_KEY) {
    throw new Error("Pembayaran DOKU belum dikonfigurasi.");
  }
  // Reuse the existing production domain, but never the simulation callback path.
  const base = new URL(process.env.DOKU_BOOKING_BASE_URL || process.env.DOKU_PRODUCTION_CALLBACK_URL || requestUrl);
  if (base.protocol !== "https:") throw new Error("URL booking DOKU harus menggunakan HTTPS.");
  return {
    callbackUrl: new URL("/payment/status", base.origin).toString(),
    notificationUrl: new URL(DOKU_BOOKING_WEBHOOK_PATH, base.origin).toString(),
  };
}

export type DokuBookingNotification = {
  order?: { invoice_number?: unknown; amount?: unknown };
  transaction?: { status?: unknown; date?: unknown; original_request_id?: unknown };
  channel?: { id?: unknown };
};

export async function processDokuBookingNotification(notification: DokuBookingNotification) {
  const invoice = notification.order?.invoice_number;
  const rawAmount = notification.order?.amount;
  const amount = typeof rawAmount === "number" || (typeof rawAmount === "string" && /^\d+(\.0+)?$/.test(rawAmount))
    ? Number(rawAmount) : NaN;
  const status = notification.transaction?.status;
  if (typeof invoice !== "string" || !isDokuBookingInvoice(invoice) || !Number.isSafeInteger(amount) || amount <= 0 || typeof status !== "string") {
    return { status: 400, body: { error: "Invalid DOKU booking notification." } };
  }

  const admin = createAdminClient();
  const { data: rental, error } = await admin.from("rentals")
    .select("id, status, gross_amount, paid_at, payment_expired_at")
    .eq("midtrans_order_id", invoice).maybeSingle();
  if (error) throw error;
  if (!rental) return { status: 404, body: { error: "Booking invoice not found." } };
  if (Number(rental.gross_amount) !== amount) {
    return { status: 409, body: { error: "Payment amount does not match booking." } };
  }
  // Checkout FAILED refers to an attempt, not the whole checkout. The customer
  // can still pay via a different channel. Unknown/non-success events never release a slot.
  if (status !== "SUCCESS") return { status: 200, body: { ok: true } };
  if (rental.paid_at) return { status: 200, body: { ok: true } };

  const now = new Date().toISOString();
  const transactionDate = notification.transaction?.date;
  const paidAt = typeof transactionDate === "string" && Number.isFinite(Date.parse(transactionDate))
    ? new Date(transactionDate).toISOString() : now;
  const metadata = {
    paid_at: paidAt,
    payment_method: `doku_${typeof notification.channel?.id === "string" ? notification.channel.id.toLowerCase() : "checkout"}`,
    // The invoice is the durable DOKU transaction reference; notification Request-Id is an event ID.
    midtrans_transaction_id: invoice,
  };

  // Conditional UPDATE guards against duplicate/concurrent events using existing
  // columns, without changing the existing payment status RPC.
  const { data: confirmed, error: confirmError } = await admin.from("rentals")
    .update({ ...metadata, status: "reserved" })
    .eq("id", rental.id).eq("status", "pending_payment").is("paid_at", null)
    .gt("payment_expired_at", now).select("id").maybeSingle();
  if (confirmError) throw confirmError;
  if (confirmed) return { status: 200, body: { ok: true } };

  // A released/cancelled slot must never be claimed again by a delayed webhook.
  // Persist the payment for manual reconciliation without changing booking status.
  const { data: recorded, error: recordError } = await admin.from("rentals")
    .update(metadata).eq("id", rental.id).is("paid_at", null).select("id").maybeSingle();
  if (recordError) throw recordError;
  if (recorded) console.error("DOKU payment requires booking reconciliation", { invoiceNumber: invoice, rentalId: rental.id });
  return { status: 200, body: { ok: true } };
}
