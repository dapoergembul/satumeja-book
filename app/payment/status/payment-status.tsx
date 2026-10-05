"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type BookingPayment = {
  status: string;
  orderId: string;
  amount: number | null;
  paymentExpiresAt: string | null;
  startedAt: string | null;
  estimatedEndedAt: string | null;
  paymentMethod: string | null;
};

const labels: Record<string, string> = {
  reserved: "Booking terkonfirmasi!",
  active: "Booking terkonfirmasi!",
  completed: "Booking selesai",
  pending_payment: "Menunggu konfirmasi pembayaran",
  expired: "Waktu pembayaran berakhir",
  payment_failed: "Pembayaran tidak berhasil",
  cancelled: "Booking dibatalkan",
  payment_review: "Pembayaran perlu konfirmasi admin",
};

function formatDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return (
    new Date(value).toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      dateStyle: "medium",
      timeStyle: "short",
    }) + " WIB"
  );
}

export default function PaymentStatus({ orderId }: { orderId: string | null }) {
  const [booking, setBooking] = useState<BookingPayment | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const loadStatus = useCallback(
    async (signal?: AbortSignal) => {
      if (!orderId) return false;
      try {
        const response = await fetch(
          `/api/payment/verify-status?orderId=${encodeURIComponent(orderId)}`,
          {
            cache: "no-store",
            signal,
          },
        );
        const payload = await response.json();
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "Transaksi tidak ditemukan."
              : "Status pembayaran belum dapat diperiksa. Silakan coba lagi.",
          );
        if (!signal?.aborted) {
          setBooking(payload);
          try {
            const stored = sessionStorage.getItem(`doku-checkout:${orderId}`);
            const url = stored ? new URL(stored) : null;
            setCheckoutUrl(
              url?.protocol === "https:" &&
                (url.hostname === "doku.com" ||
                  url.hostname.endsWith(".doku.com"))
                ? url.toString()
                : null,
            );
            if (payload.status !== "pending_payment")
              sessionStorage.removeItem(`doku-checkout:${orderId}`);
          } catch {
            setCheckoutUrl(null);
          }
          setError("");
          return ["pending_payment", "expired"].includes(payload.status);
        }
      } catch (cause) {
        if (!signal?.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Gagal memeriksa pembayaran.",
          );
        return !signal?.aborted;
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [orderId],
  );

  useEffect(() => {
    if (!orderId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const poll = async () => {
      const shouldPoll = await loadStatus(controller.signal);
      attempts += 1;
      if (shouldPoll && !controller.signal.aborted && attempts < 225)
        timer = setTimeout(poll, 4_000);
    };
    timer = setTimeout(poll, 0);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [loadStatus, orderId]);

  return (
    <main className="doku-test-page">
      <section className="doku-test-card" aria-labelledby="payment-title">
        <p className="doku-test-badge">SATU MEJA · PEMBAYARAN</p>
        <div aria-live="polite">
          <h1 id="payment-title">
            {!orderId
              ? "Transaksi tidak ditemukan"
              : booking
                ? labels[booking.status] || "Status booking sedang diperiksa"
                : "Memeriksa pembayaran"}
          </h1>
          <p className="doku-test-intro">
            {!orderId
              ? "Nomor pembayaran tidak tersedia pada tautan ini."
              : booking?.status === "payment_review"
                ? "Pembayaran sudah diterima setelah slot dilepas atau status booking berubah. Hubungi admin dengan nomor invoice di bawah untuk konfirmasi jadwal atau pengembalian dana."
                : booking?.status === "expired"
                  ? "Masa tahan slot telah berakhir. Jika sudah membayar, cek status lagi atau hubungi admin sebelum membuat pembayaran baru."
                  : booking?.status === "pending_payment"
                    ? "Jika sudah membayar, tunggu konfirmasi otomatis. Jangan membuat pembayaran baru selama transaksi ini masih diproses."
                    : "Status booking diperbarui berdasarkan konfirmasi pembayaran dari server."}
          </p>
        </div>
        {booking && (
          <dl className="doku-test-details">
            <div>
              <dt>Invoice</dt>
              <dd>{booking.orderId}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>
                {booking.amount === null
                  ? "—"
                  : `Rp${booking.amount.toLocaleString("id-ID")}`}
              </dd>
            </div>
            <div>
              <dt>Mulai</dt>
              <dd>{formatDate(booking.startedAt)}</dd>
            </div>
            <div>
              <dt>Selesai</dt>
              <dd>{formatDate(booking.estimatedEndedAt)}</dd>
            </div>
            <div>
              <dt>Batas reservasi slot</dt>
              <dd>{formatDate(booking.paymentExpiresAt)}</dd>
            </div>
          </dl>
        )}
        {error && (
          <p className="doku-test-error" role="alert">
            {error}
          </p>
        )}
        {orderId && (
          <button
            className="doku-status-button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void loadStatus();
            }}
          >
            {loading ? "Memeriksa…" : "Cek status lagi"}
          </button>
        )}
        {booking?.status === "pending_payment" && checkoutUrl && (
          <a className="doku-test-link" href={checkoutUrl}>
            Lanjutkan pembayaran
          </a>
        )}
        <Link className="doku-test-link" href="/">
          Kembali ke booking
        </Link>
        <a className="doku-test-link" href="https://wa.me/6289672094579">
          Hubungi admin
        </a>
      </section>
    </main>
  );
}
