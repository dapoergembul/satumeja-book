import { NextResponse } from "next/server";
import { verifyDokuProductionSignature } from "@/lib/doku";
import {
  DOKU_BOOKING_WEBHOOK_PATH,
  processDokuBookingNotification,
  type DokuBookingNotification,
} from "@/lib/doku-booking";

export const runtime = "nodejs";

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
      signature,
      body,
      requestTarget: DOKU_BOOKING_WEBHOOK_PATH,
    })
  ) {
    return NextResponse.json(
      { error: "Invalid DOKU signature." },
      { status: 401 },
    );
  }
  let notification: DokuBookingNotification;
  try {
    notification = JSON.parse(body);
    if (!notification || typeof notification !== "object")
      throw new Error("Invalid payload");
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 },
    );
  }
  try {
    const result = await processDokuBookingNotification(notification);
    return NextResponse.json(result.body, { status: result.status });
  } catch {
    console.error("DOKU booking notification could not be saved", {
      requestId,
    });
    return NextResponse.json(
      { error: "Unable to persist payment. Retry notification." },
      { status: 503 },
    );
  }
}
