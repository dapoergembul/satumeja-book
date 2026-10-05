import { NextResponse } from "next/server";
import {
  isDokuBookingInvoice,
  processDokuBookingNotification,
} from "@/lib/doku-booking";

import { verifyDokuProductionSignature } from "@/lib/doku";
import { updateDokuProductionTransactionFromWebhook } from "@/lib/doku-production-transactions";

export const runtime = "nodejs";

const DOKU_PRODUCTION_WEBHOOK_PATH = "/api/prod/doku/webhook";

type DokuNotification = {
  order?: { invoice_number?: unknown; amount?: unknown };
  transaction?: { status?: unknown; date?: unknown };
  channel?: { id?: unknown };
};

export async function POST(request: Request) {
  const body = await request.text();
  const clientId = request.headers.get("client-id");
  const requestId = request.headers.get("request-id");
  const requestTimestamp = request.headers.get("request-timestamp");
  const signature = request.headers.get("signature");

  if (!clientId || !requestId || !requestTimestamp || !signature) {
    return NextResponse.json(
      { error: "Missing DOKU signature headers." },
      { status: 400 },
    );
  }

  if (
    !verifyDokuProductionSignature({
      clientId,
      requestId,
      requestTimestamp,
      requestTarget: DOKU_PRODUCTION_WEBHOOK_PATH,
      body,
      signature,
    })
  ) {
    return NextResponse.json(
      { error: "Invalid DOKU signature." },
      { status: 401 },
    );
  }

  let notification: DokuNotification;
  try {
    notification = JSON.parse(body) as DokuNotification;
    if (!notification || typeof notification !== "object")
      throw new Error("Invalid payload");
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 },
    );
  }

  const invoiceNumber = notification.order?.invoice_number;
  const amount = notification.order?.amount;
  const status = notification.transaction?.status;
  if (
    typeof invoiceNumber !== "string" ||
    (typeof amount !== "number" && typeof amount !== "string") ||
    typeof status !== "string"
  ) {
    return NextResponse.json(
      { error: "Invalid DOKU notification payload." },
      { status: 400 },
    );
  }

  // Support accounts whose dashboard notification URL still points at this route.
  // Its signature has already been verified using the original request path.
  if (isDokuBookingInvoice(invoiceNumber)) {
    try {
      const result = await processDokuBookingNotification(notification);
      return NextResponse.json(result.body, { status: result.status });
    } catch {
      return NextResponse.json(
        { error: "Unable to persist booking payment." },
        { status: 503 },
      );
    }
  }

  const event = {
    invoiceNumber,
    amount,
    status,
    channel:
      typeof notification.channel?.id === "string"
        ? notification.channel.id
        : null,
    paidAt:
      typeof notification.transaction?.date === "string"
        ? notification.transaction.date
        : null,
    dokuRequestId: requestId,
  };
  try {
    const transaction = await updateDokuProductionTransactionFromWebhook(event);
    if (!transaction) {
      console.warn("DOKU production webhook invoice was not found", {
        invoiceNumber,
        dokuRequestId: requestId,
      });
    }
  } catch (error) {
    console.error("DOKU production webhook status update failed", error);
    return NextResponse.json(
      { error: "Unable to persist DOKU transaction status." },
      { status: 503 },
    );
  }
  if (status === "SUCCESS") {
    console.info("DOKU production payment succeeded", event);
  } else {
    console.warn("DOKU production payment did not succeed", event);
  }

  return NextResponse.json({ ok: true });
}
