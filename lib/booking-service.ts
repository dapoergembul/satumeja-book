// ponytail: server-side Supabase data fetching queries for SSR
import { createClient } from "@/utils/supabase/server";
import type {
  RatesData,
  RatesByMenuItem,
  StoreSettingsData,
  TableItem,
  VoucherItem,
} from "@/lib/booking-types";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  DEFAULT_PAYMENT_GATEWAY_ENABLED,
  getPaymentGatewayEnabled,
} from "@/lib/payment-settings";

const DEFAULT_RATES: RatesData = {
  weekday: [
    { minHour: 1, maxHour: 1, rate: 45000 },
    { minHour: 2, maxHour: 2, rate: 40000 },
    { minHour: 3, maxHour: Infinity, rate: 35000 },
  ],
  weekend: [
    { minHour: 1, maxHour: 1, rate: 55000 },
    { minHour: 2, maxHour: 2, rate: 50000 },
    { minHour: 3, maxHour: Infinity, rate: 45000 },
  ],
};

const DEFAULT_OPENING_HOUR = 10;
const DEFAULT_CLOSING_HOUR = 23;

function normalizeHourValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(23, Math.trunc(value)));
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\d{1,2})(?::\d{2})?(?::\d{2})?$/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

function resolveBusinessHours(row: Record<string, unknown> | null | undefined) {
  const openingHour =
    normalizeHourValue(
      row?.rental_open_time ??
        row?.opening_hour ??
        row?.open_hour ??
        row?.opening_time ??
        row?.open_time,
    ) ?? DEFAULT_OPENING_HOUR;
  const closingHour =
    normalizeHourValue(
      row?.rental_close_time ??
        row?.closing_hour ??
        row?.close_hour ??
        row?.closing_time ??
        row?.close_time,
    ) ?? DEFAULT_CLOSING_HOUR;

  return {
    openingHour,
    closingHour:
      closingHour >= openingHour ? closingHour : DEFAULT_CLOSING_HOUR,
  };
}

export async function getTables(): Promise<TableItem[]> {
  try {
    // Menu items are not publicly readable, so resolve the relation on the server.
    const supabase = createAdminClient();
    const { data: dbAssets } = await supabase
      .from("assets")
      .select("id, asset_name, status, outlet_id, menu_items(id, name)")
      .neq("status", "maintenance")
      .order("asset_name", { ascending: true });

    if (dbAssets && dbAssets.length > 0) {
      return dbAssets.map(
        (a: {
          id: number | string;
          asset_name?: string;
          outlet_id?: string;
          menu_items?:
            | { id?: string; name?: string | null }
            | { id?: string; name?: string | null }[]
            | null;
        }) => {
          const rawName = a.asset_name
            ? a.asset_name.toString()
            : `Asset ${a.id}`;
          const menuItem = Array.isArray(a.menu_items)
            ? a.menu_items[0]
            : a.menu_items;
          const menuItemId = menuItem?.id || "unassigned";
          return {
            id: a.id,
            label: rawName,
            name: rawName,
            outletId: a.outlet_id,
            menuItemId,
            menuItemName: menuItem?.name || "Unit lainnya",
          };
        },
      );
    }
  } catch {
    // Fallback if DB fetch fails
  }

  return [1, 2, 3, 4, 5, 6].map((n) => ({
    id: n,
    label: `Meja ${n}`,
    name: `Meja ${n}`,
    menuItemId: "fallback",
    menuItemName: "Meja",
  }));
}

export async function getRates(): Promise<RatesByMenuItem> {
  try {
    const supabase = await createClient();
    const { data: rulesData } = await supabase
      .from("rental_pricing_rules")
      .select(
        "id, menu_item_id, day_type, rental_pricing_tiers (id, from_hour, to_hour, price_per_hour, tier_order)",
      );

    if (rulesData && rulesData.length > 0) {
      const ratesByMenuItem: RatesByMenuItem = {};

      rulesData.forEach(
        (rule: {
          menu_item_id?: string | null;
          day_type: string;
          rental_pricing_tiers?: Array<{
            from_hour?: number | null;
            to_hour?: number | null;
            price_per_hour: number;
            tier_order?: number;
          }>;
        }) => {
          if (!rule.menu_item_id) return;

          const rates = (ratesByMenuItem[rule.menu_item_id] ||= {
            weekday: [],
            weekend: [],
          });
          const tiersList = rule.rental_pricing_tiers || [];
          tiersList.forEach((t) => {
            const item = {
              minHour: t.from_hour ?? 1,
              maxHour: t.to_hour ?? Infinity,
              rate: Number(t.price_per_hour),
            };
            if (rule.day_type === "weekend") {
              rates.weekend.push(item);
            } else {
              rates.weekday.push(item);
            }
          });
        },
      );

      if (Object.keys(ratesByMenuItem).length > 0) {
        for (const rates of Object.values(ratesByMenuItem)) {
          rates.weekday = rates.weekday.length
            ? rates.weekday.sort((a, b) => a.minHour - b.minHour)
            : DEFAULT_RATES.weekday;
          rates.weekend = rates.weekend.length
            ? rates.weekend.sort((a, b) => a.minHour - b.minHour)
            : DEFAULT_RATES.weekend;
        }

        return ratesByMenuItem;
      }
    }
  } catch {
    // Fallback to DEFAULT_RATES
  }

  return { fallback: DEFAULT_RATES };
}

export async function getVouchers(): Promise<Record<string, VoucherItem>> {
  try {
    const supabase = await createClient();
    const { data: dbVouchers } = await supabase
      .from("vouchers")
      .select("*")
      .eq("is_active", true);

    if (dbVouchers && dbVouchers.length > 0) {
      const vouchersObj: Record<string, VoucherItem> = {};
      dbVouchers.forEach(
        (v: {
          code: string;
          discount_type: string;
          discount_value: number;
          description?: string;
          start_date?: string | null;
          end_date?: string | null;
        }) => {
          const isPercent =
            v.discount_type === "percent" || v.discount_type === "percentage";
          vouchersObj[v.code.toUpperCase()] = {
            type: isPercent ? "percent" : "flat",
            value: Number(v.discount_value),
            label:
              v.description ||
              (isPercent
                ? `${v.discount_value}% off`
                : `Rp${v.discount_value} off`),
            startDate: v.start_date,
            endDate: v.end_date,
          };
        },
      );
      return vouchersObj;
    }
  } catch {
    // Return empty object if fetch fails
  }

  return {};
}

export async function getStoreSettings(): Promise<StoreSettingsData> {
  try {
    const supabase = await createClient();
    // ponytail: fetch store_settings for store_name 'Satu Meja'
    const { data: specificData } = await supabase
      .from("store_settings")
      .select(
        "tax_percentage, service_charge_percentage, store_name, weekend_days, closed_weekdays, payment_gateway_enabled, rental_open_time, rental_close_time",
      )
      .ilike("store_name", "%Satu Meja%")
      .limit(1)
      .maybeSingle();

    const data =
      specificData ||
      (
        await supabase
          .from("store_settings")
          .select(
            "tax_percentage, service_charge_percentage, weekend_days, closed_weekdays, payment_gateway_enabled, rental_open_time, rental_close_time",
          )
          .limit(1)
          .maybeSingle()
      ).data;

    if (data) {
      const { openingHour, closingHour } = resolveBusinessHours(
        data as Record<string, unknown>,
      );
      return {
        taxPercentage: Number(data.tax_percentage || 0),
        serviceChargePercentage: Number(data.service_charge_percentage || 0),
        weekendDays: Array.isArray(data.weekend_days)
          ? data.weekend_days.map((value: unknown) => Number(value))
          : [0, 5, 6],
        closedWeekdays: Array.isArray(data.closed_weekdays)
          ? data.closed_weekdays
              .map((value: unknown) => Number(value))
              .filter(
                (value: number) =>
                  Number.isInteger(value) && value >= 0 && value <= 6,
              )
          : [],
        paymentGatewayEnabled: getPaymentGatewayEnabled(data),
        openingHour,
        closingHour,
      };
    }
  } catch {
    // Fallback if DB query fails
  }

  return {
    taxPercentage: 0,
    serviceChargePercentage: 0,
    weekendDays: [0, 5, 6],
    closedWeekdays: [],
    paymentGatewayEnabled: DEFAULT_PAYMENT_GATEWAY_ENABLED,
    openingHour: DEFAULT_OPENING_HOUR,
    closingHour: DEFAULT_CLOSING_HOUR,
  };
}
