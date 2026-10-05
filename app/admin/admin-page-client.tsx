"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { AdminBookingItem } from "@/lib/admin-bookings";

interface AdminPageClientProps {
  authenticated: boolean;
  initialPaymentGatewayEnabled: boolean;
  hasAdminPasswordConfigured: boolean;
  bookings: AdminBookingItem[];
}

type BookingFilter = "all" | "review" | "verified" | "missing";

const ADMIN_TIME_ZONE = "Asia/Jakarta";

function formatDateTime(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(value: number | null) {
  if (typeof value !== "number") {
    return "—";
  }

  return `Rp${Math.round(value).toLocaleString("id-ID")}`;
}

function normalizeStatus(value: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function getVerificationBucket(booking: AdminBookingItem): BookingFilter {
  const status = normalizeStatus(booking.paymentVerificationStatus);

  if (!booking.proofUrl) {
    return "missing";
  }

  if (
    status.includes("verified") ||
    status.includes("approved") ||
    status.includes("paid")
  ) {
    return "verified";
  }

  return "review";
}

function getVerificationLabel(booking: AdminBookingItem) {
  const bucket = getVerificationBucket(booking);

  if (bucket === "missing") {
    return "No Proof";
  }

  if (bucket === "verified") {
    return "Verified";
  }

  return "Review";
}

function getFilterLabel(filter: BookingFilter) {
  switch (filter) {
    case "review":
      return "Perlu Review";
    case "verified":
      return "Terverifikasi";
    case "missing":
      return "Belum Upload";
    default:
      return "Semua";
  }
}

function matchesFilter(booking: AdminBookingItem, filter: BookingFilter) {
  if (filter === "all") {
    return true;
  }

  return getVerificationBucket(booking) === filter;
}

function getDateInputValue(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ADMIN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");

  return year && month && day ? `${year}-${month}-${day}` : null;
}

function matchesProofUploadDay(booking: AdminBookingItem, day: string) {
  return !day || getDateInputValue(booking.paymentProofUploadedAt) === day;
}

function getStatusBadgeColors(bucket: BookingFilter): React.CSSProperties {
  switch (bucket) {
    case "verified":
      return {
        backgroundColor: "#dbf3e4",
        color: "#185437",
      };
    case "missing":
      return {
        backgroundColor: "#f6dfdf",
        color: "#7a2a2a",
      };
    default:
      return {
        backgroundColor: "#fff1c8",
        color: "#1b3a2b",
      };
  }
}

const shellStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "560px",
  margin: "32px auto 64px",
};

const cardStyle: React.CSSProperties = {
  backgroundColor: "#fbf7ec",
  border: "2px solid #1b3a2b",
  borderRadius: "24px",
  padding: "24px",
  boxSizing: "border-box",
  boxShadow: "0 10px 28px -22px rgba(27,58,43,0.45)",
};

const sectionStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #c9a24b",
  borderRadius: "22px",
  padding: "20px",
  boxSizing: "border-box",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  backgroundColor: "#ffffff",
  border: "1.5px solid #d8cfa9",
  borderRadius: "12px",
  padding: "12px 14px",
  fontSize: "14px",
  lineHeight: "20px",
  color: "#1e2620",
  boxSizing: "border-box",
  outline: "none",
  minHeight: "44px",
  WebkitAppearance: "none",
  appearance: "none",
};

const primaryButtonStyle: React.CSSProperties = {
  width: "100%",
  marginTop: "16px",
  backgroundColor: "#1b3a2b",
  color: "#fbf7ec",
  border: "0",
  borderRadius: "16px",
  padding: "14px 16px",
  fontFamily: "var(--font-baloo)",
  fontWeight: 700,
  fontSize: "18px",
  lineHeight: "22px",
  cursor: "pointer",
  WebkitAppearance: "none",
  appearance: "none",
};

const ghostButtonStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #d8cfa9",
  color: "#1b3a2b",
  borderRadius: "12px",
  padding: "10px 14px",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
  WebkitAppearance: "none",
  appearance: "none",
};

const alertErrorStyle: React.CSSProperties = {
  backgroundColor: "#8c2f2f",
  color: "#fbf7ec",
  borderRadius: "16px",
  padding: "14px 16px",
  fontSize: "14px",
  lineHeight: "20px",
  marginBottom: "16px",
};

const alertOkStyle: React.CSSProperties = {
  backgroundColor: "#1b3a2b",
  color: "#fbf7ec",
  borderRadius: "16px",
  padding: "14px 16px",
  fontSize: "14px",
  lineHeight: "20px",
  marginBottom: "16px",
};

function renderToggle(
  paymentGatewayEnabled: boolean,
  isSaving: boolean,
  onClick: () => void,
) {
  return (
    <div
      style={{
        border: "1px solid #d8cfa9",
        borderRadius: "20px",
        backgroundColor: "#fffdf7",
        padding: "16px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ marginBottom: "12px" }}>
        <div
          style={{
            fontSize: "11px",
            lineHeight: "16px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#5c6b60",
            fontWeight: 700,
          }}
        >
          Payment Mode
        </div>
        <div
          style={{
            marginTop: "4px",
            fontFamily: "var(--font-baloo)",
            fontSize: "18px",
            lineHeight: "20px",
            color: "#1b3a2b",
            fontWeight: 700,
          }}
        >
          {paymentGatewayEnabled ? "DOKU Active" : "Manual Proof"}
        </div>
        <div
          style={{
            marginTop: "8px",
            fontSize: "13px",
            lineHeight: "19px",
            color: "#5c6b60",
          }}
        >
          {paymentGatewayEnabled
            ? "Customer pays instantly with gateway checkout."
            : "Customer uploads transfer proof for admin review."}
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={paymentGatewayEnabled}
        aria-label="Gunakan Payment Gateway"
        disabled={isSaving}
        onClick={onClick}
        style={{
          display: "inline-block",
          width: "92px",
          height: "52px",
          borderRadius: "999px",
          border: `2px solid ${paymentGatewayEnabled ? "#1b3a2b" : "#bda96e"}`,
          backgroundColor: paymentGatewayEnabled ? "#2c5a44" : "#efe1b8",
          padding: "0",
          position: "relative",
          cursor: isSaving ? "not-allowed" : "pointer",
          opacity: isSaving ? 0.7 : 1,
          WebkitAppearance: "none",
          appearance: "none",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "50%",
            left: paymentGatewayEnabled ? "47px" : "7px",
            width: "36px",
            height: "36px",
            borderRadius: "999px",
            transform: "translateY(-50%)",
            backgroundColor: paymentGatewayEnabled ? "#fbf7ec" : "#1b3a2b",
          }}
        />
        <span
          style={{
            position: "absolute",
            left: "12px",
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: "10px",
            lineHeight: "12px",
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: paymentGatewayEnabled ? "rgba(251,247,236,0.75)" : "#1b3a2b",
          }}
        >
          OFF
        </span>
        <span
          style={{
            position: "absolute",
            right: "12px",
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: "10px",
            lineHeight: "12px",
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: paymentGatewayEnabled ? "#fbf7ec" : "rgba(27,58,43,0.65)",
          }}
        >
          ON
        </span>
      </button>
    </div>
  );
}

export default function AdminPageClient({
  authenticated,
  initialPaymentGatewayEnabled,
  hasAdminPasswordConfigured,
  bookings,
}: AdminPageClientProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [paymentGatewayEnabled, setPaymentGatewayEnabled] = useState(
    initialPaymentGatewayEnabled,
  );
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(
    null,
  );
  const [activeFilter, setActiveFilter] = useState<BookingFilter>("all");
  const [proofUploadDay, setProofUploadDay] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dayFilteredBookings = bookings.filter((booking) =>
    matchesProofUploadDay(booking, proofUploadDay),
  );
  const reviewCount = dayFilteredBookings.filter(
    (booking) => getVerificationBucket(booking) === "review",
  ).length;
  const verifiedCount = dayFilteredBookings.filter(
    (booking) => getVerificationBucket(booking) === "verified",
  ).length;
  const missingCount = dayFilteredBookings.filter(
    (booking) => getVerificationBucket(booking) === "missing",
  ).length;
  const filteredBookings = dayFilteredBookings.filter((booking) =>
    matchesFilter(booking, activeFilter),
  );
  const selectedBooking =
    bookings.find((booking) => booking.id === selectedBookingId) ?? null;

  useEffect(() => {
    if (!selectedBooking) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedBookingId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedBooking]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Login admin gagal.");
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login admin gagal.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.refresh();
  };

  const handleSave = async (nextValue: boolean) => {
    setIsSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/payment-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentGatewayEnabled: nextValue }),
      });

      const payload = (await response.json()) as {
        error?: string;
        paymentGatewayEnabled?: boolean;
      };

      if (!response.ok || typeof payload.paymentGatewayEnabled !== "boolean") {
        throw new Error(payload.error || "Gagal menyimpan pengaturan pembayaran.");
      }

      setPaymentGatewayEnabled(payload.paymentGatewayEnabled);
      setMessage(
        payload.paymentGatewayEnabled
          ? "DOKU diaktifkan kembali."
          : "DOKU dimatikan. Form booking sekarang mewajibkan upload bukti transfer.",
      );
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Gagal menyimpan pengaturan pembayaran.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!hasAdminPasswordConfigured) {
    return (
      <section style={shellStyle}>
        <div
          style={{
            backgroundColor: "#8c2f2f",
            color: "#fbf7ec",
            borderRadius: "24px",
            padding: "24px",
          }}
        >
          <h1
            style={{
              margin: "0 0 8px",
              fontFamily: "var(--font-baloo)",
              fontSize: "28px",
              lineHeight: "30px",
            }}
          >
            Admin Payment
          </h1>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: "21px" }}>
            `ADMIN_ACCESS_PASSWORD` belum di-set, jadi halaman admin belum bisa
            dipakai.
          </p>
        </div>
      </section>
    );
  }

  if (!authenticated) {
    return (
      <section style={shellStyle}>
        <div style={cardStyle}>
          <h1
            style={{
              margin: "0 0 8px",
              fontFamily: "var(--font-baloo)",
              fontSize: "30px",
              lineHeight: "32px",
              color: "#1b3a2b",
            }}
          >
            Admin Payment
          </h1>
          <p
            style={{
              margin: "0 0 20px",
              fontSize: "14px",
              lineHeight: "21px",
              color: "#5c6b60",
            }}
          >
            Login untuk mengatur apakah booking memakai DOKU atau upload
            bukti transfer manual.
          </p>

          {error ? <div style={alertErrorStyle}>{error}</div> : null}

          <label
            htmlFor="admin-password"
            style={{
              display: "block",
              marginBottom: "6px",
              fontFamily: "var(--font-baloo)",
              fontWeight: 700,
              fontSize: "14px",
              lineHeight: "18px",
              color: "#1b3a2b",
            }}
          >
            Password Admin
          </label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={inputStyle}
          />

          <button
            type="button"
            onClick={handleLogin}
            disabled={!password.trim() || isLoggingIn}
            style={{
              ...primaryButtonStyle,
              opacity: !password.trim() || isLoggingIn ? 0.45 : 1,
              cursor: !password.trim() || isLoggingIn ? "not-allowed" : "pointer",
            }}
          >
            {isLoggingIn ? "Memproses..." : "Masuk"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section style={shellStyle}>
      <div style={cardStyle}>
        <div
          style={{
            marginBottom: "20px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div>
              <h1
                style={{
                  margin: 0,
                  fontFamily: "var(--font-baloo)",
                  fontSize: "30px",
                  lineHeight: "32px",
                  color: "#1b3a2b",
                }}
              >
                Admin Payment
              </h1>
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: "14px",
                  lineHeight: "21px",
                  color: "#5c6b60",
                }}
              >
                Ubah mode checkout tanpa deploy ulang.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={handleLogout}
                style={ghostButtonStyle}
              >
                Logout
              </button>
            </div>
          </div>
        </div>

        {error ? <div style={alertErrorStyle}>{error}</div> : null}
        {message ? <div style={alertOkStyle}>{message}</div> : null}

        <div style={sectionStyle}>
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-baloo)",
              fontSize: "22px",
              lineHeight: "24px",
              color: "#1b3a2b",
            }}
          >
            Gunakan Payment Gateway
          </p>
          <p
            style={{
              margin: "10px 0 16px",
              fontSize: "14px",
              lineHeight: "21px",
              color: "#5c6b60",
            }}
          >
            Saat aktif, customer bayar lewat DOKU. Saat nonaktif, customer
            wajib upload bukti transfer dan booking langsung masuk ke status
            reservasi.
          </p>

          {renderToggle(paymentGatewayEnabled, isSaving, () =>
            handleSave(!paymentGatewayEnabled),
          )}

          <div
            style={{
              display: "inline-block",
              marginTop: "16px",
              borderRadius: "999px",
              backgroundColor: "#fff7dd",
              padding: "6px 12px",
              fontSize: "14px",
              lineHeight: "18px",
              fontWeight: 600,
              color: "#1b3a2b",
            }}
          >
            {paymentGatewayEnabled
              ? "Status: DOKU aktif"
              : "Status: Upload bukti transfer"}
          </div>
        </div>

        <div style={{ ...sectionStyle, marginTop: "20px" }}>
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--font-baloo)",
              fontSize: "22px",
              lineHeight: "24px",
              color: "#1b3a2b",
            }}
          >
            Booking Manual
          </h2>
          <p
            style={{
              margin: "10px 0 16px",
              fontSize: "14px",
              lineHeight: "21px",
              color: "#5c6b60",
            }}
          >
            Review booking manual tanpa harus melihat semua bukti pembayaran
            sekaligus.
          </p>

          <div className="admin-summary-grid">
            <div className="admin-summary-card">
              <span className="admin-summary-label">Total</span>
              <strong className="admin-summary-value">
                {dayFilteredBookings.length}
              </strong>
              <span className="admin-summary-note">
                {proofUploadDay ? "Sesuai tanggal unggah" : "Booking manual terbaru"}
              </span>
            </div>
            <div className="admin-summary-card">
              <span className="admin-summary-label">Review</span>
              <strong className="admin-summary-value">{reviewCount}</strong>
              <span className="admin-summary-note">Bukti perlu dicek</span>
            </div>
            <div className="admin-summary-card">
              <span className="admin-summary-label">Verified</span>
              <strong className="admin-summary-value">{verifiedCount}</strong>
              <span className="admin-summary-note">Sudah terverifikasi</span>
            </div>
            <div className="admin-summary-card">
              <span className="admin-summary-label">Missing</span>
              <strong className="admin-summary-value">{missingCount}</strong>
              <span className="admin-summary-note">Belum ada bukti</span>
            </div>
          </div>

          <div className="admin-proof-date-filter">
            <label htmlFor="proof-upload-day">Tanggal unggah bukti</label>
            <div className="admin-proof-date-filter-controls">
              <input
                id="proof-upload-day"
                type="date"
                value={proofUploadDay}
                onChange={(event) => {
                  setProofUploadDay(event.target.value);
                  setSelectedBookingId(null);
                }}
                style={inputStyle}
              />
              {proofUploadDay ? (
                <button
                  type="button"
                  onClick={() => setProofUploadDay("")}
                  style={ghostButtonStyle}
                >
                  Reset
                </button>
              ) : null}
            </div>
          </div>

          <div className="admin-filter-row">
            {(
              [
                "all",
                "review",
                "verified",
                "missing",
              ] as BookingFilter[]
            ).map((filter) => {
              const isActive = activeFilter === filter;

              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => {
                    setActiveFilter(filter);
                    setSelectedBookingId(null);
                  }}
                  aria-pressed={isActive}
                  className="admin-filter-chip"
                  style={{
                    backgroundColor: isActive ? "#1b3a2b" : "#fffdf7",
                    borderColor: isActive ? "#1b3a2b" : "#d8cfa9",
                    color: isActive ? "#fbf7ec" : "#1b3a2b",
                  }}
                >
                  {getFilterLabel(filter)}
                </button>
              );
            })}
          </div>

          {bookings.length === 0 ? (
            <div
              style={{
                border: "1px solid #e4dbc0",
                borderRadius: "16px",
                backgroundColor: "#fffdf7",
                padding: "16px",
                fontSize: "14px",
                lineHeight: "21px",
                color: "#5c6b60",
              }}
            >
              Belum ada booking manual yang bisa ditampilkan.
            </div>
          ) : (
            <>
              {filteredBookings.length === 0 ? (
                <div
                  style={{
                    border: "1px solid #e4dbc0",
                    borderRadius: "16px",
                    backgroundColor: "#fffdf7",
                    padding: "16px",
                    fontSize: "14px",
                    lineHeight: "21px",
                    color: "#5c6b60",
                  }}
                >
                  Tidak ada booking pada filter ini.
                </div>
              ) : (
                <div className="admin-review-layout">
                  <div className="admin-review-list">
                    {filteredBookings.map((booking) => {
                      const isSelected = booking.id === selectedBooking?.id;
                      const verificationBucket = getVerificationBucket(booking);
                      return (
                        <button
                          key={booking.id}
                          type="button"
                          onClick={() => setSelectedBookingId(booking.id)}
                          className="admin-booking-row"
                          style={{
                            borderColor: isSelected ? "#1b3a2b" : "#dfd5b6",
                            boxShadow: isSelected
                              ? "0 18px 28px -26px rgba(27,58,43,0.65)"
                              : "none",
                          }}
                        >
                          <div className="admin-booking-tags">
                            <span
                              className="admin-status-badge"
                              style={{
                                ...getStatusBadgeColors(verificationBucket),
                              }}
                            >
                              {getVerificationLabel(booking)}
                            </span>
                            <span className="admin-select-indicator">
                              {isSelected ? "Dipilih" : "Lihat bukti"}
                            </span>
                          </div>
                          <p className="admin-booking-name">
                            {booking.customerName || "Tanpa nama"}
                          </p>
                          <p className="admin-booking-description">
                            {booking.assetName || "Asset tidak diketahui"}
                          </p>
                          <div className="admin-booking-meta-grid">
                            <div className="admin-booking-meta-item">
                              <span>Total pembayaran</span>
                              <strong>{formatCurrency(booking.grossAmount)}</strong>
                            </div>
                            <div className="admin-booking-meta-item">
                              <span>Waktu booking</span>
                              <strong>{formatDateTime(booking.startedAt)}</strong>
                            </div>
                            <div className="admin-booking-meta-item">
                              <span>Telepon</span>
                              <strong>{booking.customerPhone || "No phone"}</strong>
                            </div>
                            <div className="admin-booking-meta-item">
                              <span>Status booking</span>
                              <strong>{booking.status || "unknown"}</strong>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {selectedBooking ? (
                    <div className="admin-proof-sheet-root">
                      <button
                        type="button"
                        className="admin-proof-sheet-backdrop"
                        aria-label="Tutup detail bukti pembayaran"
                        onClick={() => setSelectedBookingId(null)}
                      />
                      <aside
                        className="admin-proof-sheet"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="payment-proof-sheet-title"
                      >
                        <div className="admin-proof-sheet-handle" />
                      <div
                        className="admin-proof-sheet-header"
                        style={{
                          alignItems: "flex-start",
                          gap: "12px",
                        }}
                      >
                        <div className="admin-proof-sheet-heading">
                          <p
                            style={{
                              margin: 0,
                              fontSize: "11px",
                              lineHeight: "14px",
                              fontWeight: 700,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              color: "#5c6b60",
                            }}
                          >
                            Bukti Pembayaran
                          </p>
                          <h3
                            id="payment-proof-sheet-title"
                            style={{
                              margin: "8px 0 0",
                              fontFamily: "var(--font-baloo)",
                            fontSize: "24px",
                            lineHeight: "26px",
                            color: "#1b3a2b",
                            overflowWrap: "anywhere",
                          }}
                          >
                            {selectedBooking.customerName || "Tanpa nama"}
                          </h3>
                        </div>
                        <div className="admin-proof-sheet-actions">
                          <span
                            className="admin-proof-sheet-badge"
                            style={{
                              ...getStatusBadgeColors(
                                getVerificationBucket(selectedBooking),
                              ),
                            }}
                          >
                            {getVerificationLabel(selectedBooking)}
                          </span>
                          <button
                            type="button"
                            className="admin-proof-sheet-close"
                            onClick={() => setSelectedBookingId(null)}
                            aria-label="Tutup detail bukti pembayaran"
                          >
                            Tutup
                          </button>
                        </div>
                      </div>

                      <div className="admin-proof-preview">
                        {selectedBooking.proofUrl &&
                        (selectedBooking.paymentProofMimeType?.startsWith(
                          "image/",
                        ) ??
                          true) ? (
                          <a
                            href={selectedBooking.proofUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: "block",
                              width: "100%",
                              height: "100%",
                            }}
                          >
                            <img
                              src={selectedBooking.proofUrl}
                              alt={`Bukti pembayaran ${selectedBooking.customerName || selectedBooking.id}`}
                              style={{
                                display: "block",
                                width: "100%",
                                height: "100%",
                                objectFit: "contain",
                              }}
                            />
                          </a>
                        ) : selectedBooking.proofUrl ? (
                          <div
                            style={{
                              textAlign: "center",
                              padding: "24px",
                            }}
                          >
                            <p
                              style={{
                                margin: "0 0 14px",
                                fontSize: "14px",
                                lineHeight: "21px",
                                color: "#5c6b60",
                              }}
                            >
                              Bukti pembayaran tersedia sebagai file.
                            </p>
                            <a
                              href={selectedBooking.proofUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: "inline-block",
                                borderRadius: "12px",
                                backgroundColor: "#1b3a2b",
                                padding: "10px 14px",
                                color: "#fbf7ec",
                                fontSize: "14px",
                                lineHeight: "18px",
                                fontWeight: 600,
                                textDecoration: "none",
                              }}
                            >
                              Buka File Bukti
                            </a>
                          </div>
                        ) : (
                          <div
                            style={{
                              textAlign: "center",
                              padding: "24px",
                            }}
                          >
                            <p
                              style={{
                                margin: 0,
                                fontSize: "14px",
                                lineHeight: "21px",
                                color: "#5c6b60",
                              }}
                            >
                              Customer belum mengunggah bukti pembayaran.
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="admin-proof-details">
                        <div className="admin-detail-item">
                          <span className="admin-detail-label">Asset</span>
                          <strong className="admin-detail-value">
                            {selectedBooking.assetName || "Asset tidak diketahui"}
                          </strong>
                        </div>
                        <div className="admin-detail-item">
                          <span className="admin-detail-label">Total</span>
                          <strong className="admin-detail-value">
                            {formatCurrency(selectedBooking.grossAmount)}
                          </strong>
                        </div>
                        <div className="admin-detail-item">
                          <span className="admin-detail-label">Mulai</span>
                          <strong className="admin-detail-value">
                            {formatDateTime(selectedBooking.startedAt)}
                          </strong>
                        </div>
                        <div className="admin-detail-item">
                          <span className="admin-detail-label">Estimasi selesai</span>
                          <strong className="admin-detail-value">
                            {formatDateTime(selectedBooking.estimatedEndedAt)}
                          </strong>
                        </div>
                        <div className="admin-detail-item">
                          <span className="admin-detail-label">Metode bayar</span>
                          <strong className="admin-detail-value">
                            {selectedBooking.paymentMethod || "—"}
                          </strong>
                        </div>
                        <div className="admin-detail-item">
                          <span className="admin-detail-label">Status booking</span>
                          <strong className="admin-detail-value">
                            {selectedBooking.status || "unknown"}
                          </strong>
                        </div>
                      </div>
                      </aside>
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <style jsx>{`
        .admin-summary-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 16px;
        }

        .admin-summary-card {
          border: 1px solid #e4dbc0;
          border-radius: 18px;
          background: linear-gradient(180deg, #fffdf7 0%, #f8f2e1 100%);
          padding: 14px;
        }

        .admin-summary-label {
          display: block;
          font-size: 11px;
          line-height: 14px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #5c6b60;
        }

        .admin-summary-value {
          display: block;
          margin-top: 8px;
          font-family: var(--font-baloo);
          font-size: 30px;
          line-height: 30px;
          color: #1b3a2b;
        }

        .admin-summary-note {
          display: block;
          margin-top: 6px;
          font-size: 13px;
          line-height: 18px;
          color: #5c6b60;
        }

        .admin-filter-row {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 16px;
        }

        .admin-proof-date-filter {
          margin-bottom: 16px;
        }

        .admin-proof-date-filter label {
          display: block;
          margin-bottom: 6px;
          font-family: var(--font-baloo);
          font-size: 14px;
          font-weight: 700;
          line-height: 18px;
          color: #1b3a2b;
        }

        .admin-proof-date-filter-controls {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .admin-proof-date-filter-controls input {
          flex: 1;
        }

        .admin-filter-chip {
          border: 1px solid #d8cfa9;
          border-radius: 999px;
          padding: 10px 14px;
          font-size: 13px;
          line-height: 18px;
          font-weight: 700;
          cursor: pointer;
          appearance: none;
          -webkit-appearance: none;
        }

        .admin-review-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 16px;
        }

        .admin-review-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .admin-booking-row {
          width: 100%;
          display: block;
          padding: 16px;
          border: 1px solid #dfd5b6;
          border-radius: 18px;
          background-color: #fffdf6;
          text-align: left;
          cursor: pointer;
          box-sizing: border-box;
          appearance: none;
          -webkit-appearance: none;
          min-width: 0;
          overflow: hidden;
        }

        .admin-booking-tags {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin-top: 10px;
          min-width: 0;
        }

        .admin-booking-name {
          margin: 12px 0 0;
          min-width: 0;
          overflow-wrap: anywhere;
          font-family: var(--font-baloo);
          font-size: 22px;
          line-height: 25px;
          color: #1b3a2b;
        }

        .admin-booking-description {
          margin: 5px 0 0;
          min-width: 0;
          overflow-wrap: anywhere;
          font-size: 13px;
          line-height: 19px;
          color: #5c6b60;
        }

        .admin-booking-meta-grid {
          margin-top: 14px;
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 8px;
          font-size: 12px;
          line-height: 17px;
          color: #3f4b42;
          min-width: 0;
        }

        .admin-booking-meta-item {
          min-width: 0;
          border-top: 1px solid #eadfbc;
          padding-top: 8px;
        }

        .admin-booking-meta-item > span {
          display: block;
          font-size: 10px;
          line-height: 14px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          overflow-wrap: anywhere;
          color: #6b756c;
        }

        .admin-booking-meta-item > strong {
          display: block;
          margin-top: 3px;
          overflow-wrap: anywhere;
          word-break: break-word;
          font-size: 13px;
          line-height: 18px;
          font-weight: 700;
          color: #29372e;
        }

        .admin-select-indicator {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          max-width: 100%;
          border-radius: 999px;
          background-color: #1b3a2b;
          color: #fbf7ec;
          padding: 8px 12px;
          font-size: 12px;
          line-height: 16px;
          font-weight: 700;
          white-space: nowrap;
        }

        .admin-status-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          align-self: flex-end;
          max-width: 100%;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 10px;
          line-height: 13px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          text-align: center;
          box-sizing: border-box;
          white-space: nowrap;
        }

        .admin-proof-sheet-root {
          position: fixed;
          z-index: 50;
          inset: 0;
          display: flex;
          align-items: flex-end;
          justify-content: center;
        }

        .admin-proof-sheet-backdrop {
          position: absolute;
          inset: 0;
          border: 0;
          background: rgba(24, 35, 28, 0.45);
          cursor: pointer;
          appearance: none;
          -webkit-appearance: none;
        }

        .admin-proof-sheet {
          position: relative;
          z-index: 1;
          width: min(720px, 100%);
          max-height: 86vh;
          max-height: min(86dvh, 760px);
          overflow-x: hidden;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          border: 1px solid #dfd5b6;
          border-bottom: 0;
          border-radius: 24px 24px 0 0;
          background: linear-gradient(180deg, #fffefb 0%, #f8f3e5 100%);
          box-sizing: border-box;
          padding: 10px 16px calc(24px + env(safe-area-inset-bottom));
          animation: admin-proof-sheet-enter 180ms ease-out;
        }

        .admin-proof-sheet-handle {
          width: 42px;
          height: 4px;
          margin: 0 auto 16px;
          border-radius: 999px;
          background-color: #c5ba96;
        }

        .admin-proof-sheet-header {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          min-width: 0;
        }

        .admin-proof-sheet-heading {
          flex: 1 1 180px;
          min-width: 0;
        }

        .admin-proof-sheet-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .admin-proof-sheet-badge {
          display: inline-flex;
          align-items: center;
          min-width: 0;
          max-width: 100%;
          border-radius: 999px;
          padding: 7px 12px;
          font-size: 11px;
          line-height: 14px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          overflow-wrap: anywhere;
          box-sizing: border-box;
        }

        .admin-proof-sheet-close {
          flex: 0 0 auto;
          border: 1px solid #d8cfa9;
          border-radius: 999px;
          background: #fffdf7;
          padding: 7px 12px;
          color: #1b3a2b;
          font-size: 12px;
          line-height: 16px;
          font-weight: 700;
          cursor: pointer;
          appearance: none;
          -webkit-appearance: none;
        }

        @keyframes admin-proof-sheet-enter {
          from {
            transform: translateY(100%);
          }

          to {
            transform: translateY(0);
          }
        }

        .admin-proof-preview {
          margin-top: 14px;
          min-height: 280px;
          border: 1px solid #eadfbc;
          border-radius: 18px;
          background-color: #fff;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .admin-proof-details {
          margin-top: 14px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .admin-detail-item {
          border: 1px solid #eadfbc;
          border-radius: 16px;
          background-color: #fffdf7;
          padding: 12px;
        }

        .admin-detail-label {
          display: block;
          margin-bottom: 6px;
          font-size: 11px;
          line-height: 14px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #5c6b60;
        }

        .admin-detail-value {
          display: block;
          font-size: 14px;
          line-height: 20px;
          color: #1e2620;
        }

        @media (min-width: 920px) {
          .admin-summary-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }

        }

        @media (max-width: 639px) {
          .admin-summary-grid {
            grid-template-columns: minmax(0, 1fr);
          }

          .admin-booking-row {
            padding: 14px;
          }

          .admin-booking-meta-grid,
          .admin-proof-details {
            grid-template-columns: minmax(0, 1fr);
          }

          .admin-proof-preview {
            min-height: 220px;
          }

          .admin-proof-sheet {
            max-height: 90vh;
            max-height: 90dvh;
            padding-right: 14px;
            padding-left: 14px;
          }
        }
      `}</style>
    </section>
  );
}
