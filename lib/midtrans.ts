import crypto from "node:crypto";

// Retained only to settle Midtrans payments issued before the DOKU cutover.
export function verifyMidtransSignature(payload: {
  order_id: string;
  status_code: string;
  gross_amount: string;
  signature_key: string;
}) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;

  if (!serverKey) {
    return false;
  }

  const expected = crypto
    .createHash("sha512")
    .update(
      `${payload.order_id}${payload.status_code}${payload.gross_amount}${serverKey}`,
    )
    .digest("hex");

  return expected === payload.signature_key;
}
