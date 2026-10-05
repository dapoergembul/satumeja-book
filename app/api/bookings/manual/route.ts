import { randomUUID } from "node:crypto";
import path from "node:path";

import { NextResponse } from "next/server";

import {
  fetchBookingQuote,
  normalizeBookingPayload,
  reserveBooking,
} from "@/lib/booking-request";
import { isPastBookingStart } from "@/lib/booking-time";
import { PAYMENT_PROOF_BUCKET } from "@/lib/payment-settings";
import { createAdminClient } from "@/utils/supabase/admin";
import { createPublicServerClient } from "@/utils/supabase/public-server";

export const runtime = "nodejs";

// Keep this below Vercel's request-body limit so this route can return JSON errors.
const MAX_PAYMENT_PROOF_BYTES = 4 * 1024 * 1024;
const ALLOWED_PAYMENT_PROOF_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function sanitizeExtension(fileName: string, mimeType: string) {
  const raw = path.extname(fileName).toLowerCase();

  if (raw) {
    return raw.replace(/[^a-z0-9.]/g, "");
  }

  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("paymentProof");

    if (!(file instanceof File)) {
      return jsonError("Bukti pembayaran wajib diunggah.");
    }

    if (!ALLOWED_PAYMENT_PROOF_TYPES.has(file.type)) {
      return jsonError("Format bukti pembayaran harus JPG, PNG, WEBP, atau PDF.");
    }

    if (file.size > MAX_PAYMENT_PROOF_BYTES) {
      return jsonError("Ukuran bukti pembayaran maksimal 4MB.");
    }

    const payload = normalizeBookingPayload({
      name: formData.get("name"),
      phone: formData.get("phone"),
      assetId: formData.get("assetId"),
      date: formData.get("date"),
      startHour: formData.get("startHour"),
      endHour: formData.get("endHour"),
      voucherCode: formData.get("voucherCode"),
    });

    if (!payload.name || !payload.phone || !payload.assetId || !payload.date) {
      return jsonError("Data booking belum lengkap.");
    }

    if (
      !Number.isInteger(payload.startHour) ||
      !Number.isInteger(payload.endHour) ||
      payload.endHour <= payload.startHour
    ) {
      return jsonError("Jam booking tidak valid.");
    }

    if (isPastBookingStart(payload.date, payload.startHour)) {
      return jsonError("Jam booking sudah lewat. Silakan pilih jam lain.");
    }

    const publicClient = createPublicServerClient();
    const quote = await fetchBookingQuote(publicClient, payload);

    if (quote.paymentGatewayEnabled) {
      return jsonError(
        "Payment gateway sedang aktif. Gunakan pembayaran DOKU.",
        409,
      );
    }

    const orderId = `manual-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const reservation = await reserveBooking(publicClient, {
      ...payload,
      asset: quote.asset,
      grossAmount: quote.totals.total,
      hourlyRate: quote.totals.rate,
      orderId,
    });

    const admin = createAdminClient();
    const ext = sanitizeExtension(file.name, file.type);
    const storagePath = `manual-bookings/${payload.date}/${reservation.rentalId}-${randomUUID()}${ext}`;
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const uploadResult = await admin.storage
      .from(PAYMENT_PROOF_BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadResult.error) {
      await publicClient.rpc("update_web_booking_payment_status", {
        p_order_id: orderId,
        p_status: "payment_failed",
        p_payment_method: null,
        p_transaction_id: null,
      });

      return jsonError(uploadResult.error.message || "Gagal upload bukti pembayaran.", 500);
    }

    const { error: statusError } = await publicClient.rpc(
      "update_web_booking_payment_status",
      {
        p_order_id: orderId,
        p_status: "reserved",
        p_payment_method: "manual_transfer",
        p_transaction_id: null,
      },
    );

    if (statusError) {
      return jsonError(
        statusError.message || "Booking tersimpan, tetapi status pembayaran gagal diperbarui.",
        500,
      );
    }

    const { error: proofUpdateError } = await admin
      .from("rentals")
      .update({
        payment_proof_path: storagePath,
        payment_proof_uploaded_at: new Date().toISOString(),
        payment_proof_mime_type: file.type,
        payment_proof_size_bytes: file.size,
        payment_verification_status: "pending_review",
      })
      .eq("id", reservation.rentalId);

    if (proofUpdateError) {
      return jsonError(
        proofUpdateError.message ||
          "Booking tersimpan, tetapi metadata bukti pembayaran gagal disimpan.",
        500,
      );
    }

    return NextResponse.json({
      ok: true,
      rentalId: reservation.rentalId,
      storagePath,
      message:
        "Booking tersimpan. Bukti pembayaran sudah diupload dan menunggu verifikasi admin.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Terjadi kesalahan pada server.";

    return jsonError(message, 500);
  }
}
