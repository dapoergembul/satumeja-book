import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const resolveModule = createRequire(import.meta.url);

// Load the real TS modules with boundary mocks; no Next server or live payments.
function load(file, mocks = {}, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports, require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : resolveModule(name),
    process: { env: { DOKU_PRODUCTION_CLIENT_ID: "test-client", DOKU_PRODUCTION_SECRET_KEY: "test-secret" } },
    Buffer, URL, Date, AbortSignal, console: { error() {} }, ...globals,
  }, { filename: file });
  return exports;
}

const invoice = `DOKUBK${"a".repeat(24)}`;
const event = (status = "SUCCESS", amount = "10000") => ({
  order: { invoice_number: invoice, amount }, transaction: { status, date: new Date().toISOString() }, channel: { id: "QRIS" },
});

function database(overrides = {}) {
  const row = {
    id: "rental-1", status: "pending_payment", midtrans_order_id: invoice,
    gross_amount: 10000, paid_at: null, payment_expired_at: new Date(Date.now() + 600000).toISOString(), ...overrides,
  };
  let writes = 0;
  const client = { from() {
    let patch;
    const predicates = [];
    const query = {
      select() { return query; },
      update(value) { patch = value; return query; },
      eq(key, value) { predicates.push(() => row[key] === value); return query; },
      is(key, value) { predicates.push(() => row[key] === value); return query; },
      gt(key, value) { predicates.push(() => row[key] > value); return query; },
      async maybeSingle() {
        if (!predicates.every((match) => match())) return { data: null, error: null };
        if (patch) { Object.assign(row, patch); writes++; }
        return { data: { ...row }, error: null };
      },
      then(resolve) { return query.maybeSingle().then(resolve); },
    };
    return query;
  } };
  return { row, client, writes: () => writes };
}
function processor(db) {
  return load("lib/doku-booking.ts", { "@/utils/supabase/admin": { createAdminClient: () => db.client } }).processDokuBookingNotification;
}

test("SUCCESS confirms the held booking once, including concurrent delivery", async () => {
  const db = database(); const processEvent = processor(db);
  await Promise.all([processEvent(event()), processEvent(event())]);
  assert.equal(db.row.status, "reserved");
  assert.equal(db.row.payment_method, "doku_qris");
  assert.equal(db.row.midtrans_transaction_id, invoice);
  assert.equal(db.writes(), 1);
  await processEvent(event("FAILED"));
  assert.equal(db.row.status, "reserved");
  assert.equal(db.writes(), 1);
});

test("FAILED and unknown events keep the slot available for another payment attempt", async () => {
  for (const status of ["FAILED", "PENDING", "EXPIRED", "UNKNOWN"]) {
    const db = database(); await processor(db)(event(status));
    assert.equal(db.row.status, "pending_payment"); assert.equal(db.writes(), 0);
  }
});

test("wrong amounts and non-booking invoices never write", async () => {
  const db = database(); const processEvent = processor(db);
  assert.equal((await processEvent(event("SUCCESS", "9999"))).status, 409);
  assert.equal((await processEvent(event("SUCCESS", ""))).status, 400);
  const invalid = event(); invalid.order.invoice_number = "DOKUPROD" + "a".repeat(20);
  assert.equal((await processEvent(invalid)).status, 400);
  assert.equal(db.writes(), 0);
});

test("late success records payment without reclaiming an expired or cancelled slot", async () => {
  for (const status of ["pending_payment", "expired", "cancelled", "payment_failed"]) {
    const db = database({ status, payment_expired_at: new Date(Date.now() - 1000).toISOString() });
    await processor(db)(event());
    assert.equal(db.row.status, status); assert.ok(db.row.paid_at);
    await processor(db)(event()); assert.equal(db.writes(), 1);
  }
});

test("production checkout uses the booking invoice, total, callback, signature and expiry", async () => {
  let sent;
  const doku = load("lib/doku.ts", {}, { fetch: async (url, options) => {
    sent = { url, ...options };
    return new Response(JSON.stringify({ response: { payment: { url: "https://checkout.doku.com/example" } } }));
  } });
  const checkout = await doku.createDokuProductionCheckout({ invoiceNumber: invoice, amount: 10000, customerName: "Test", customerPhone: "081234567890", customerEmail: "test@example.com", paymentDueMinutes: 14, callbackUrl: "https://booking.example.com/payment/status", notificationUrl: "https://booking.example.com/api/payment/doku/webhook" });
  const payload = JSON.parse(sent.body);
  assert.equal(sent.url, "https://api.doku.com/checkout/v1/payment");
  assert.equal(payload.order.invoice_number, invoice); assert.equal(checkout.invoiceNumber, invoice);
  assert.equal(payload.order.amount, 10000); assert.equal(payload.payment.payment_due_date, 14);
  assert.equal(payload.customer.phone, "6281234567890"); assert.equal(payload.order.recover_abandoned_cart, false);
  assert.equal(new URL(payload.order.callback_url).searchParams.get("invoice_number"), invoice);
  assert.equal(doku.verifyDokuProductionSignature({ clientId: "test-client", requestId: sent.headers["Request-Id"], requestTimestamp: sent.headers["Request-Timestamp"], signature: sent.headers.Signature, body: sent.body, requestTarget: "/checkout/v1/payment" }), true);
});

test("webhook rejects forged signatures and altered bodies before touching storage", async () => {
  const doku = load("lib/doku.ts");
  let calls = 0;
  const target = "/api/payment/doku/webhook";
  const route = load("app/api/payment/doku/webhook/route.ts", {
    "next/server": { NextResponse: Response }, "@/lib/doku": doku,
    "@/lib/doku-booking": { DOKU_BOOKING_WEBHOOK_PATH: target, processDokuBookingNotification: async () => { calls++; return { status: 200, body: { ok: true } }; } },
  });
  const body = JSON.stringify(event()); const requestId = "test-request"; const timestamp = new Date().toISOString();
  const digest = crypto.createHash("sha256").update(body).digest("base64");
  const component = `Client-Id:test-client\nRequest-Id:${requestId}\nRequest-Timestamp:${timestamp}\nRequest-Target:${target}\nDigest:${digest}`;
  const signature = "HMACSHA256=" + crypto.createHmac("sha256", "test-secret").update(component).digest("base64");
  const request = (bodyValue, signatureValue) => new Request("https://booking.example.com" + target, { method: "POST", body: bodyValue, headers: { "client-id": "test-client", "request-id": requestId, "request-timestamp": timestamp, signature: signatureValue } });
  assert.equal((await route.POST(request(body, "forged"))).status, 401);
  assert.equal((await route.POST(request(body.replace("10000", "20000"), signature))).status, 401);
  assert.equal(calls, 0);
  assert.equal((await route.POST(request(body, signature))).status, 200); assert.equal(calls, 1);
});

test("checkout timeout preserves the hold; definite rejection releases it", async () => {
  const doku = load("lib/doku.ts");
  for (const failure of [new Error("timeout"), new doku.DokuApiError("rejected", 400, "request")]) {
    const db = database();
    const route = load("app/api/payment/create-transaction/route.ts", {
      "next/server": { NextResponse: Response },
      "@/lib/booking-time": { isPastBookingStart: () => false },
      "@/utils/supabase/public-server": { createPublicServerClient: () => db.client },
      "@/utils/supabase/admin": { createAdminClient: () => db.client },
      "@/lib/doku-booking": { createDokuBookingInvoice: () => invoice, getDokuBookingUrls: () => ({}) },
      "@/lib/doku": { DokuApiError: doku.DokuApiError, createDokuProductionCheckout: async () => { throw failure; } },
      "@/lib/booking-request": {
        normalizeBookingPayload: (body) => body,
        fetchBookingQuote: async () => ({ paymentGatewayEnabled: true, asset: {}, totals: { total: 10000, rate: 10000 } }),
        reserveBooking: async () => ({ rentalId: db.row.id, paymentExpiresAt: db.row.payment_expired_at }),
      },
    });
    const result = await route.POST(new Request("https://booking.example.com/api/payment/create-transaction", { method: "POST", body: JSON.stringify({ name: "Test", phone: "081234567890", email: "test@example.com", assetId: "asset", date: "2030-01-01", startHour: 10, endHour: 11 }) }));
    assert.equal(result.status, failure instanceof doku.DokuApiError ? 502 : 202);
    assert.equal(db.row.status, failure instanceof doku.DokuApiError ? "payment_failed" : "pending_payment");
  }
});
