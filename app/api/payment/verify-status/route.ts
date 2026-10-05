import { NextResponse } from "next/server";

import { createAdminClient } from "@/utils/supabase/admin";
import { isDokuBookingInvoice } from "@/lib/doku-booking";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("orderId");

  if (
    !orderId ||
    (!isDokuBookingInvoice(orderId) && !/^booking-[a-f0-9]{24}$/.test(orderId))
  ) {
    return NextResponse.json(
      { error: "orderId is required." },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("rentals")
      .select(
        "id, status, midtrans_order_id, payment_expired_at, started_at, estimated_ended_at, gross_amount, payment_method, paid_at",
      )
      .eq("midtrans_order_id", orderId)
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: "Status pembayaran belum dapat diperiksa." },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Booking payment not found." },
        { status: 404 },
      );
    }

    const confirmed = ["reserved", "active", "completed"].includes(data.status);
    const needsReview =
      isDokuBookingInvoice(orderId) && !!data.paid_at && !confirmed;
    const expired =
      data.status === "pending_payment" &&
      data.payment_expired_at &&
      Date.parse(data.payment_expired_at) <= Date.now();

    return NextResponse.json(
      {
        rentalId: data.id,
        status: needsReview
          ? "payment_review"
          : expired
            ? "expired"
            : data.status,
        amount: data.gross_amount === null ? null : Number(data.gross_amount),
        paymentMethod: data.payment_method,
        paidAt: data.paid_at,
        orderId: data.midtrans_order_id,
        paymentExpiresAt: data.payment_expired_at,
        startedAt: data.started_at,
        estimatedEndedAt: data.estimated_ended_at,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Status pembayaran belum dapat diperiksa." },
      { status: 503 },
    );
  }
}
