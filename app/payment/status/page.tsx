import type { Metadata } from "next";
import PaymentStatus from "./payment-status";

export const metadata: Metadata = {
  title: "Status pembayaran — Satu Meja",
  robots: { index: false, follow: false },
};

export default async function PaymentStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ invoice_number?: string | string[] }>;
}) {
  const query = await searchParams;
  const invoice = Array.isArray(query.invoice_number)
    ? query.invoice_number[0]
    : query.invoice_number;
  return <PaymentStatus orderId={invoice || null} />;
}
