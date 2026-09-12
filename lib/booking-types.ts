export interface RateItem {
  minHour: number;
  maxHour: number;
  rate: number;
}

export interface RatesData {
  weekday: RateItem[];
  weekend: RateItem[];
}

export type RatesByMenuItem = Record<string, RatesData>;

export interface TableItem {
  id: number | string;
  label: string;
  name: string;
  outletId?: string;
  menuItemId: string;
  menuItemName: string;
}

export interface VoucherItem {
  type: "percent" | "flat";
  value: number;
  label: string;
  startDate?: string | null;
  endDate?: string | null;
}

export interface StoreSettingsData {
  taxPercentage: number;
  serviceChargePercentage: number;
  weekendDays: number[];
  closedWeekdays: number[];
  paymentGatewayEnabled: boolean;
  openingHour: number;
  closingHour: number;
}
