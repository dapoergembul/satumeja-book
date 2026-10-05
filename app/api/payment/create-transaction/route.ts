import { NextResponse } from "next/server";

import {
  fetchBookingQuote,
  normalizeBookingPayload,
  reserveBooking,
  type CreateBookingPayload,
} from "@/lib/booking-request";
import { isPastBookingStart } from "@/lib/booking-time";
import { createDokuProductionCheckout, DokuApiError } from "@/lib/doku";
import {
  createDokuBookingInvoice,
  getDokuBookingUrls,
} from "@/lib/doku-booking";
import { createAdminClient } from "@/utils/supabase/admin";
import { createPublicServerClient } from "@/utils/supabase/public-server";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateBookingPayload & {
      email?: unknown;
    };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 128)
      return jsonError("Email pembayaran tidak valid.");
    const { name, phone, assetId, date, startHour, endHour, voucherCode } =
      normalizeBookingPayload(body);

    if (!name || !phone || !assetId || !date) {
      return jsonError("Data booking belum lengkap.");
    }

    if (
      !Number.isInteger(startHour) ||
      !Number.isInteger(endHour) ||
      endHour <= startHour
    ) {
      return jsonError("Jam booking tidak valid.");
    }

    if (isPastBookingStart(date, startHour)) {
      return jsonError("Jam booking sudah lewat. Silakan pilih jam lain.");
    }

    const supabase = createPublicServerClient();
    const quote = await fetchBookingQuote(supabase, {
      name,
      phone,
      assetId,
      date,
      startHour,
      endHour,
      voucherCode,
    });

    if (!quote.paymentGatewayEnabled) {
      return jsonError(
        "Pembayaran gateway sedang dimatikan. Silakan upload bukti transfer pada form booking.",
        409,
      );
    }

    const amount = Math.round(quote.totals.total);
    if (
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      amount > 999_999_999_999
    ) {
      return jsonError(
        "Total pembayaran harus berupa nominal rupiah bulat lebih dari nol.",
      );
    }
    const urls = getDokuBookingUrls(request.url);
    const admin = createAdminClient();
    const orderId = createDokuBookingInvoice();
    const bookingData = await reserveBooking(supabase, {
      name,
      phone,
      assetId,
      date,
      startHour,
      endHour,
      voucherCode,
      asset: quote.asset,
      grossAmount: amount,
      hourlyRate: quote.totals.rate,
      orderId,
    });

    const statusUrl = `/payment/status?invoice_number=${encodeURIComponent(orderId)}`;
    const expiry = Date.parse(bookingData.paymentExpiresAt || "");
    // Round down and leave a network margin so checkout ends before the slot hold.
    const paymentDueMinutes = Math.min(
      14,
      Math.floor((expiry - Date.now() - 30_000) / 60_000),
    );
    if (!Number.isFinite(paymentDueMinutes) || paymentDueMinutes < 1) {
      const { error } = await admin
        .from("rentals")
        .update({ status: "payment_failed" })
        .eq("midtrans_order_id", orderId)
        .eq("status", "pending_payment")
        .is("paid_at", null);
      if (error)
        console.error("Unable to release uninitialized DOKU booking", {
          orderId,
        });
      return jsonError(
        "Waktu pembayaran booking tidak tersedia. Silakan coba lagi.",
        409,
      );
    }

    try {
      const checkout = await createDokuProductionCheckout({
        invoiceNumber: orderId,
        amount,
        customerName: name,
        customerPhone: phone,
        customerEmail: email,
        paymentDueMinutes,
        ...urls,
      });

      return NextResponse.json({
        checkoutUrl: checkout.checkoutUrl,
        statusUrl,
        orderId,
        rentalId: bookingData.rentalId,
        paymentExpiresAt: bookingData.paymentExpiresAt,
      });
    } catch (error) {
      console.error("DOKU booking checkout failed", {
        orderId,
        status: error instanceof DokuApiError ? error.status : null,
      });
      // A timeout/5xx may occur after DOKU created the checkout. Keep the hold
      // and expose its status instead of encouraging a second payment attempt.
      if (
        !(error instanceof DokuApiError) ||
        error.status < 400 ||
        error.status >= 500 ||
        error.status === 409 ||
        error.status === 429
      ) {
        return NextResponse.json(
          {
            orderId,
            statusUrl,
            paymentExpiresAt: bookingData.paymentExpiresAt,
          },
          { status: 202 },
        );
      }
      const { error: releaseError } = await admin
        .from("rentals")
        .update({ status: "payment_failed" })
        .eq("midtrans_order_id", orderId)
        .eq("status", "pending_payment")
        .is("paid_at", null);
      if (releaseError)
        console.error("Unable to release rejected DOKU booking", { orderId });
      return jsonError(
        "DOKU belum dapat membuat pembayaran. Silakan coba lagi.",
        502,
      );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Terjadi kesalahan pada server.";

    return jsonError(message, 500);
  }
}
