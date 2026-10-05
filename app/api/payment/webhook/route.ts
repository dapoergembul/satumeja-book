import { NextResponse } from "next/server";

import { verifyMidtransSignature } from "@/lib/midtrans";
import { createPublicServerClient } from "@/utils/supabase/public-server";

export const runtime = "nodejs";

interface MidtransWebhookBody {
  order_id?: string;
  status_code?: string;
  gross_amount?: string;
  signature_key?: string;
  transaction_status?: string;
  fraud_status?: string;
  payment_type?: string;
  transaction_id?: string;
}

function mapMidtransStatus(body: MidtransWebhookBody) {
  const transactionStatus = body.transaction_status;
  const fraudStatus = body.fraud_status;

  if (
    transactionStatus === "settlement" ||
    (transactionStatus === "capture" &&
      (!fraudStatus || fraudStatus === "accept"))
  ) {
    return "reserved";
  }

  if (transactionStatus === "pending") {
    return "pending_payment";
  }

  if (transactionStatus === "expire") {
    return "expired";
  }

  if (transactionStatus === "cancel" || transactionStatus === "deny") {
    return "payment_failed";
  }

  return "payment_failed";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as MidtransWebhookBody;

    if (
      !body.order_id ||
      !/^booking-[a-f0-9]{24}$/.test(body.order_id) ||
      !body.status_code ||
      !body.gross_amount ||
      !body.signature_key
    ) {
      return NextResponse.json(
        { error: "Invalid webhook payload." },
        { status: 400 },
      );
    }

    if (
      !verifyMidtransSignature(
        body as Required<
          Pick<
            MidtransWebhookBody,
            "order_id" | "status_code" | "gross_amount" | "signature_key"
          >
        >,
      )
    ) {
      return NextResponse.json(
        { error: "Invalid signature." },
        { status: 401 },
      );
    }

    const nextStatus = mapMidtransStatus(body);
    const supabase = createPublicServerClient();

    const { error } = await supabase.rpc("update_web_booking_payment_status", {
      p_order_id: body.order_id,
      p_status: nextStatus,
      p_payment_method: body.payment_type || null,
      p_transaction_id: body.transaction_id || null,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Webhook processing failed.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
