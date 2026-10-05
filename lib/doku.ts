import crypto from "node:crypto";

const DOKU_SANDBOX_API_URL = "https://api-sandbox.doku.com";
const DOKU_PRODUCTION_API_URL = "https://api.doku.com";
const DOKU_CHECKOUT_PATH = "/checkout/v1/payment";

type DokuCheckoutInput = {
  amount: number;
  customerName: string;
  customerEmail?: string;
  invoiceNumber?: string;
  paymentDueMinutes?: number;
  customerPhone?: string;
  callbackUrl?: string;
  notificationUrl?: string;
};

export class DokuApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId: string,
  ) {
    super(message);
  }
}

function getDokuCredentials(environment: "sandbox" | "production") {
  const isProduction = environment === "production";
  const clientId = isProduction
    ? process.env.DOKU_PRODUCTION_CLIENT_ID
    : process.env.DOKU_SANDBOX_CLIENT_ID;
  const secretKey = isProduction
    ? process.env.DOKU_PRODUCTION_SECRET_KEY
    : process.env.DOKU_SANDBOX_SECRET_KEY;
  if (!clientId || !secretKey)
    throw new Error(
      isProduction
        ? "DOKU production belum dikonfigurasi. Tambahkan DOKU_PRODUCTION_CLIENT_ID dan DOKU_PRODUCTION_SECRET_KEY ke environment deployment."
        : "DOKU sandbox belum dikonfigurasi. Tambahkan DOKU_SANDBOX_CLIENT_ID dan DOKU_SANDBOX_SECRET_KEY ke .env.",
    );
  return { clientId, secretKey };
}

function createDokuSignature(input: {
  clientId: string;
  secretKey: string;
  requestId: string;
  requestTimestamp: string;
  requestTarget: string;
  body: string;
}) {
  const digest = crypto
    .createHash("sha256")
    .update(input.body)
    .digest("base64");
  const component = [
    `Client-Id:${input.clientId}`,
    `Request-Id:${input.requestId}`,
    `Request-Timestamp:${input.requestTimestamp}`,
    `Request-Target:${input.requestTarget}`,
    `Digest:${digest}`,
  ].join("\n");
  return `HMACSHA256=${crypto.createHmac("sha256", input.secretKey).update(component).digest("base64")}`;
}

export function verifyDokuSandboxSignature(input: {
  clientId: string;
  requestId: string;
  requestTimestamp: string;
  requestTarget: string;
  body: string;
  signature: string;
}) {
  return verifyDokuSignature(input, "sandbox");
}

export function verifyDokuProductionSignature(input: {
  clientId: string;
  requestId: string;
  requestTimestamp: string;
  requestTarget: string;
  body: string;
  signature: string;
}) {
  return verifyDokuSignature(input, "production");
}

function verifyDokuSignature(
  input: {
    clientId: string;
    requestId: string;
    requestTimestamp: string;
    requestTarget: string;
    body: string;
    signature: string;
  },
  environment: "sandbox" | "production",
) {
  const expectedClientId =
    environment === "production"
      ? process.env.DOKU_PRODUCTION_CLIENT_ID
      : process.env.DOKU_SANDBOX_CLIENT_ID;
  const secretKey =
    environment === "production"
      ? process.env.DOKU_PRODUCTION_SECRET_KEY
      : process.env.DOKU_SANDBOX_SECRET_KEY;

  if (!expectedClientId || !secretKey || input.clientId !== expectedClientId) {
    return false;
  }

  const expected = createDokuSignature({
    clientId: input.clientId,
    secretKey,
    requestId: input.requestId,
    requestTimestamp: input.requestTimestamp,
    requestTarget: input.requestTarget,
    body: input.body,
  });
  const actualBuffer = Buffer.from(input.signature);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function createCallbackUrl(
  callbackUrl: string,
  invoiceNumber: string,
  amount: number,
  result?: "cancel",
) {
  const url = new URL(callbackUrl);
  if (result) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/${result}`;
  }
  url.searchParams.set("invoice_number", invoiceNumber);
  url.searchParams.set("amount", String(amount));

  return url.toString();
}

async function createDokuCheckout(
  input: DokuCheckoutInput,
  environment: "sandbox" | "production",
) {
  const { clientId, secretKey } = getDokuCredentials(environment);
  const invoicePrefix = environment === "production" ? "DOKUPROD" : "DOKUDEV";
  const invoiceNumber = input.invoiceNumber ?? `${invoicePrefix}${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const phone = input.customerPhone?.replace(/\D/g, "").replace(/^0/, "62");
  const callbackUrl = input.callbackUrl
    ? createCallbackUrl(input.callbackUrl, invoiceNumber, input.amount)
    : undefined;
  const cancelCallbackUrl = input.callbackUrl
    ? createCallbackUrl(
        input.callbackUrl,
        invoiceNumber,
        input.amount,
        environment === "production" ? undefined : "cancel",
      )
    : undefined;
  const payload = {
    order: {
      amount: input.amount,
      invoice_number: invoiceNumber,
      currency: "IDR",
      auto_redirect: true,
      ...(input.invoiceNumber ? { recover_abandoned_cart: false } : {}),
      ...(callbackUrl
        ? {
            callback_url: callbackUrl,
            callback_url_cancel: cancelCallbackUrl,
            callback_url_result: callbackUrl,
          }
        : {}),
      line_items: [
        {
          id:
            environment === "production"
              ? "doku-production-booking"
              : "doku-sandbox-booking",
          name:
            environment === "production"
              ? "Booking Satu Meja"
              : "Booking test Satu Meja",
          quantity: 1,
          price: input.amount,
        },
      ],
    },
    payment: {
      payment_due_date: input.paymentDueMinutes ?? 15,
    },
    ...(input.notificationUrl
      ? {
          additional_info: {
            override_notification_url: input.notificationUrl,
          },
        }
      : {}),
    customer: {
      name: input.customerName,
      ...(input.customerEmail ? { email: input.customerEmail } : {}),
      ...(phone ? { phone } : {}),
    },
  };
  const body = JSON.stringify(payload);
  const requestId = crypto.randomUUID();
  const requestTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const signature = createDokuSignature({
    clientId,
    secretKey,
    requestId,
    requestTimestamp,
    requestTarget: DOKU_CHECKOUT_PATH,
    body,
  });
  const apiUrl =
    environment === "production"
      ? DOKU_PRODUCTION_API_URL
      : DOKU_SANDBOX_API_URL;
  const response = await fetch(`${apiUrl}${DOKU_CHECKOUT_PATH}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Client-Id": clientId,
      "Request-Id": requestId,
      "Request-Timestamp": requestTimestamp,
      Signature: signature,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const rawResponse = await response.text();
  const result = (() => {
    try {
      return JSON.parse(rawResponse) as {
        message?: string[];
        error_messages?: string[];
        error?: { message?: string };
        errors?: { message?: string };
        responseMessage?: string;
        response?: { payment?: { url?: string; expired_date?: string } };
      };
    } catch {
      return null;
    }
  })();
  const payment = result?.response?.payment;
  if (!response.ok || !payment?.url) {
    throw new DokuApiError(
      result?.error_messages?.join(" ") ||
        result?.message?.join(" ") ||
        result?.error?.message ||
        result?.errors?.message ||
        result?.responseMessage ||
        rawResponse.slice(0, 1_000) ||
        "DOKU gagal membuat sesi pembayaran.",
      response.status,
      requestId,
    );
  }
  return {
    checkoutUrl: payment.url,
    invoiceNumber,
    expiresAt: payment.expired_date ?? null,
  };
}

export async function createDokuSandboxCheckout(input: DokuCheckoutInput) {
  return createDokuCheckout(input, "sandbox");
}

export async function createDokuProductionCheckout(input: DokuCheckoutInput) {
  return createDokuCheckout(input, "production");
}
