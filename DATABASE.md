# Database schema

This document describes the live Supabase `public` schema used by Satu Meja. It was reconciled on 12 September 2026 against the project's PostgREST OpenAPI schema and the canonical migration history in the Flow POS repository (`supabase/migrations/`). It documents structure only: no credentials or customer data are included.

This Next.js repository does not contain migrations. The Flow POS repository is the migration source of truth; the live schema remains authoritative when it differs from historical migrations.

## Conventions

- All IDs are UUIDs. `id` is the primary key unless stated otherwise.
- `created_at` and `updated_at` values are timestamp with time zone unless stated otherwise.
- `→` denotes a foreign key.
- Fields marked `nullable` are not required by the exposed API contract.
- Constraints, indexes, triggers, RLS, and Storage details below come from the Flow POS migration history. Confirm them against the live database before making schema changes.

## Relationship overview

```text
outlets
 ├─ store_settings, tables, categories, menu_items, assets, vouchers, shifts, orders, rentals
 ├─ profiles.default_outlet_id
 └─ modifier_groups

categories ──< menu_items ──< rental_pricing_rules ──< rental_pricing_tiers
menu_items ──< assets
menu_items ──< order_items >── orders ──< payments
orders ──< order_item_addition_batches ──< order_items
assets ──< rentals
profiles ──< orders and shifts
modifier_groups ──< modifier_options
menu_items >──< modifier_groups through menu_modifier_mappings
```

## Tables

### `outlets`

Tenant/location root for operational and booking data.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | PK; defaults to `gen_random_uuid()` |
| `name` | `varchar` | Required |
| `created_at` | `timestamptz` | Defaults to `now()` |

Deleting an outlet cascades to its settings, tables, catalog, assets, vouchers, orders, shifts, and rentals through their `outlet_id` foreign keys.

### `licensing`

Application-wide plan limits. This table has no exposed foreign keys.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | PK; default UUID |
| `max_outlets` | `integer` | Default `1` |
| `max_rental_enabled_outlets` | `integer` | Default `1` |
| `plan_name` | `varchar` | Default `Basic` |
| `expires_at` | `timestamptz` | Nullable |
| `created_at`, `updated_at` | `timestamptz` | Default `now()` |

### `profiles`

Staff profile keyed by the related Supabase Auth user ID.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | PK; no default shown |
| `name` | `text` | Nullable |
| `role` | `varchar` | Nullable |
| `default_outlet_id` | `uuid` | Nullable → `outlets.id` |
| `updated_at` | `timestamptz` | Nullable |

### `store_settings`

Per-outlet commercial and booking configuration.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | PK; default UUID |
| `outlet_id` | `uuid` | Required → `outlets.id` |
| `store_name`, `store_address` | `varchar` | Required; defaults `FlowPOS`, `No Address` |
| `tax_percentage`, `service_charge_percentage` | `numeric` | Nullable |
| `rental_enabled`, `payment_gateway_enabled` | `boolean` | Required; gateway defaults `true` |
| `rental_open_time`, `rental_close_time` | `time` | Defaults `09:00:00`, `22:00:00` |
| `weekend_days`, `closed_weekdays` | `integer[]` | Nullable weekday numbers |
| `billing_model` | `varchar` | Default `prepaid` |
| `updated_at` | `timestamptz` | Default `now()` |

`closed_weekdays` is constrained to values from `0` (Sunday) through `6` (Saturday).

### `tables`

Traditional dining/POS tables. Booking UI currently uses `assets`, not this table.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | PK; default UUID |
| `outlet_id` | `uuid` | Required → `outlets.id` |
| `name` | `varchar` | Required |
| `type` | `varchar` | Required; default `restaurant` |
| `is_active` | `boolean` | Required; default `true` |
| `created_at`, `updated_at` | `timestamptz` | Required; default `CURRENT_TIMESTAMP` |

Constraint: `UNIQUE (outlet_id, name)`.

### Catalog and modifiers

| Table | Columns | Relationships |
| --- | --- | --- |
| `categories` | `id`, `name` nullable, `icon_key` nullable, `outlet_id` nullable | `outlet_id` → `outlets.id` |
| `menu_items` | `id`, `name` nullable, `price` nullable integer, `description` nullable, `is_available` nullable boolean, `category_id` required, `created_at` nullable, `outlet_id` nullable, `item_type` required enum, `duration_increment_minutes` nullable, `is_asset_tracked` required boolean, `pricing_mode` nullable enum | `category_id` → `categories.id`; `outlet_id` → `outlets.id` |
| `modifier_groups` | `id`, `name` required, `max_select` required integer default `1`, `outlet_id` nullable | `outlet_id` → `outlets.id` |
| `modifier_options` | `id`, `group_id`, `name`, `additional_price` (all required) | `group_id` → `modifier_groups.id` |
| `menu_modifier_mappings` | `id`, `menu_item_id`, `modifier_group_id` (all required) | joins `menu_items` and `modifier_groups` |

`menu_items.item_type`: `fnb`, `timer_up`, or `timer_down`.

`menu_items.pricing_mode`: `flat_hourly` or `tiered`; default `flat_hourly`.

### Assets and rental pricing

| Table | Columns | Relationships |
| --- | --- | --- |
| `assets` | `id`, `outlet_id`, `menu_item_id`, `asset_name`, `status`, `created_at` (all required; UUID/timestamps defaulted) | `outlet_id` → `outlets.id`; `menu_item_id` → `menu_items.id` |
| `rental_pricing_rules` | `id` default UUID, `menu_item_id` nullable, `day_type` required, `created_at` nullable | `menu_item_id` → `menu_items.id` |
| `rental_pricing_tiers` | `id` default UUID, `rule_id` nullable, `tier_order` required, `from_hour` required, `to_hour` nullable, `price_per_hour` required | `rule_id` → `rental_pricing_rules.id` |

The booking service treats an asset with `status = 'maintenance'` as unavailable. Pricing rules are partitioned by `day_type` (the application uses `weekday` and `weekend`), with tiers sorted by `from_hour`.

Constraints and indexes:

- `assets.outlet_id` and `assets.menu_item_id` cascade on delete; valid operational statuses are documented as `available`, `occupied`, and `maintenance`.
- `rental_pricing_rules.menu_item_id` and `rental_pricing_tiers.rule_id` cascade on delete.
- `rental_pricing_tiers` has `UNIQUE (rule_id, tier_order)`.

### Vouchers

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | PK; default UUID |
| `outlet_id` | `uuid` | Nullable → `outlets.id` |
| `code` | `varchar` | Required |
| `description` | `text` | Nullable |
| `discount_type` | `varchar` | Required; app recognizes `percent`, `percentage`, and flat values |
| `discount_value` | `numeric` | Required |
| `min_spend`, `max_discount_amount` | `integer` | Minimum required; cap nullable |
| `usage_limit`, `times_used` | `integer` | Limit nullable; used count required |
| `start_date`, `end_date` | `timestamptz` | Nullable |
| `is_active` | `boolean` | Required; default `true` |
| `created_at` | `timestamptz` | Required; default `now()` |

Constraints and index: `code` is globally unique; `discount_type` is constrained to `percentage` or `amount`; `discount_value > 0`; and `idx_vouchers_outlet_code (outlet_id, code)` supports lookup.

### POS orders and payments

| Table | Columns | Relationships |
| --- | --- | --- |
| `orders` | `id`, `order_number`, `cashier_id`, `subtotal`, `tax`, `service_charge`, `total`, `created_at` required; `outlet_id`, `table_name`, discount fields, `payment_status`, and `customer_name` nullable | `cashier_id` → `profiles.id`; `outlet_id` → `outlets.id` |
| `order_item_addition_batches` | `id` default UUID, `order_id`, `created_at` required | `order_id` → `orders.id` |
| `order_items` | `id`, `order_id`, `menu_item_id`, `quantity`, `unit_price` required; `notes`, `modifier_snapshot`, `addition_batch_id` nullable | `order_id` → `orders.id`; `menu_item_id` → `menu_items.id`; `addition_batch_id` → `order_item_addition_batches.id` |
| `payments` | `id`, `order_id`, `method`, `amount_paid`, `amount_due`, `change_given` required | `order_id` → `orders.id` |
| `shifts` | `id`, `cashier_id`, `opened_at`, `closed_at`, `opening_balance`, total sales/cash fields required; closing values and `outlet_id` nullable | `cashier_id` → `profiles.id`; `outlet_id` → `outlets.id` |

### `rentals`

Booking and payment record. This is the primary web-booking table.

| Column group | Columns |
| --- | --- |
| Identity and links | `id` (PK/default UUID), `outlet_id` required → `outlets.id`, `asset_id` nullable → `assets.id`, `order_item_id` nullable → `order_items.id` |
| Booking | `started_at` required/default `now()`, `duration_minutes` nullable, `estimated_ended_at` nullable, `actual_ended_at` nullable, `status` required/default `active`, `created_at` required/default `now()` |
| Customer and price | `customer_name` nullable, `customer_phone` nullable, `fnb_items` required `jsonb`, `locked_price_per_hour` nullable, `initial_booked_hours` nullable, `gross_amount` nullable `numeric` |
| Payment gateway | `midtrans_order_id`, `payment_expired_at`, `paid_at`, `payment_method`, `midtrans_transaction_id` (all nullable) |
| Manual proof | `payment_proof_path`, `payment_proof_uploaded_at`, `payment_proof_mime_type`, `payment_proof_size_bytes` (`bigint`), `payment_verification_status` (all nullable) |

Constraints, indexes, and trigger:

- `midtrans_order_id` is unique when present.
- `payment_verification_status` is either `pending_review`, `approved`, `rejected`, or `NULL`.
- `idx_rentals_asset_booking_window (asset_id, started_at, estimated_ended_at, status)` supports overlap checks.
- `idx_rentals_pending_payment_expiry (payment_expired_at)` is partial to `status = 'pending_payment'`.
- `rentals_payment_verification_status_idx (payment_verification_status)` supports manual-proof review.
- `reject_rental_on_closed_weekday` runs before an insert or relevant update. It looks up the outlet's `closed_weekdays`, evaluates `started_at` in `Asia/Jakarta`, and rejects a booking on a closed weekday.

## RPC functions

All RPCs are exposed through PostgREST. Parameter names below are the public contract.

| Function | Required parameters | Optional parameters |
| --- | --- | --- |
| `append_items_to_unpaid_order` | `p_order_id uuid`, `p_items jsonb` | — |
| `create_order_atomic` | order, cashier, totals, payment, items, and `p_outlet_id` fields | `p_payment_status` |
| `settle_order_payment` | `p_order_id`, `p_method`, `p_amount_paid`, `p_amount_due`, `p_change_given` | — |
| `delete_order_item_atomic` | `p_order_id`, `p_order_item_id` | — |
| `wipe_all_order_data` | `p_outlet_id` | — |
| `create_outlet` | `p_name` | — |
| `has_outlet_access` | `p_outlet_id` | — |
| `create_web_booking` | outlet, asset, customer, start time, duration, rate, gross amount, and `p_order_id` | `p_voucher_code` |
| `create_web_booking_payment` | `p_rental_id`, outlet, asset, customer, start time, duration, rate, gross amount, and `p_midtrans_order_id` | `p_voucher_code` |
| `update_web_booking_payment_status` | `p_order_id`, `p_status` | `p_payment_method`, `p_transaction_id` |

Current booking-payment behavior from migration history:

- `create_web_booking_payment` is a `SECURITY DEFINER` function with `search_path` set to empty. It validates voucher dates and limits, increments `times_used`, checks time overlap, then inserts a `pending_payment` rental with a 15-minute hold. Its JSON result includes `rental_id`, `status`, `payment_expired_at`, `started_at`, and `estimated_ended_at`.
- `update_web_booking_payment_status` is also `SECURITY DEFINER` with an empty `search_path`. It updates by `midtrans_order_id`, retains existing method/transaction values if inputs are null, sets `paid_at` when status becomes `reserved`, and returns the rental and order identifiers plus status.
- POS adjustment functions (`append_items_to_unpaid_order`, `delete_order_item_atomic`, and `settle_order_payment`) are `SECURITY DEFINER`, restrict execution to `authenticated` and `service_role`, and include outlet-access or owner checks. Payment settlement is idempotent because `payments.order_id` is unique and the function upserts the payment record.

## Application access pattern

- Browser/server public client reads availability from `assets` and `rentals`; it reads settings, pricing, and vouchers to quote a booking.
- Public booking creation calls `create_web_booking_payment` and payment status updates call `update_web_booking_payment_status`.
- Server-only admin routes use the service-role key for payment-proof storage, admin booking views, and settings updates.
- Manual proof files are stored in the `payment-proofs` bucket.

The bucket is private, has a 5 MiB object limit, and allows only PDF, JPEG, PNG, and WebP. The Next.js upload route applies a tighter 4 MiB limit.

## Security note

At the time of documentation, a zero-row/count-only request with the project publishable key showed that anonymous users can see rental rows. This is intentional in migration `20260814123000_enable_public_booking_website_access.sql`: it grants anonymous SELECT access and installs an `USING (true)` SELECT policy on `rentals`. Later migrations also grant anonymous INSERT and UPDATE privileges. `rentals` contains customer contact and payment-related metadata, so this is a high-priority exposure.

Most core tables have RLS enabled. However, migration `20260813122600_grant_all_public_tables.sql` grants `ALL` privileges on every public table, function, and sequence to `anon`, `authenticated`, and `service_role`, including default privileges. RLS can still restrict rows, but broad privileges plus public policies and publicly executable `SECURITY DEFINER` RPCs make policy review essential.

Limit public booking access to a narrow availability view or RPC that returns only an asset identifier and occupied time range. Remove public direct reads of `rentals`, and make every public booking/payment RPC validate its permitted state transition and caller context. Do not rely on `TO authenticated` alone.

## Maintenance

When the schema changes, add a Supabase migration to the Flow POS repository and update this document in the same change. Record the migration filename, constraints, indexes, RLS policies, trigger behavior, function return types, and Storage bucket policies alongside the table definitions.
