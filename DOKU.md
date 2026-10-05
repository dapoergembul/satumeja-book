# Pembayaran booking utama: DOKU Production

Booking utama membuat checkout DOKU Production. `/prod/doku` tetap menjadi halaman simulasi terpisah. Tidak ada migrasi, perubahan kolom, policy, atau definisi RPC database.

## Konfigurasi deployment

Gunakan credential production yang sudah digunakan simulasi:

- `DOKU_PRODUCTION_CLIENT_ID`
- `DOKU_PRODUCTION_SECRET_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server saja; sudah digunakan fitur admin)
- `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Opsional: `DOKU_BOOKING_BASE_URL=https://domain-booking-anda` untuk menetapkan domain publik. Jika kosong, aplikasi memakai origin dari `DOKU_PRODUCTION_CALLBACK_URL` yang sudah ada, lalu origin request sebagai fallback. Domain harus HTTPS dan dapat diakses publik. Preview yang memakai credential production juga membuat transaksi production; gunakan unit test untuk validasi tanpa uang nyata.

Endpoint booking utama:

- Callback: `https://domain-booking-anda/payment/status`
- Notification: `https://domain-booking-anda/api/payment/doku/webhook`

Checkout mengirim URL notification utama melalui `override_notification_url`. Cocokkan konfigurasi notification channel di DOKU Dashboard dengan endpoint tersebut. Endpoint lama `/api/prod/doku/webhook` juga mengenali invoice booking utama jika notifikasi masih dikirim ke konfigurasi simulasi; signature tetap diverifikasi terhadap path yang benar. Invoice simulasi tetap ditangani di Redis.

`DOKU_PRODUCTION_CALLBACK_URL` dan `DOKU_PRODUCTION_NOTIFICATION_URL` masih digunakan simulasi. Checkout utama tidak memakai path simulasi dari kedua variabel tersebut.

## Alur dan kompatibilitas data

1. Server memvalidasi jadwal, harga, voucher, serta pengaturan gateway.
2. Total dibulatkan ke rupiah bulat sesuai tampilan form.
3. RPC existing `create_web_booking_payment` menahan slot dan menyimpan invoice `DOKUBK` + 24 digit hex di `midtrans_order_id`.
4. Checkout menerima invoice dan nominal yang sama. Email dikirim ke DOKU tanpa menambahkan kolom email.
5. Form mengarahkan pengguna ke DOKU. URL checkout disimpan di session storage agar dapat dilanjutkan dari halaman status dalam tab yang sama.
6. Notifikasi `SUCCESS` yang valid memperbarui rental menjadi `reserved`, mencatat `paid_at`, metode `doku_<channel>`, dan invoice sebagai `midtrans_transaction_id`.

Pembuatan reservasi tetap memakai RPC existing. Pembaruan DOKU menggunakan UPDATE bersyarat pada kolom existing melalui admin client agar notifikasi bersamaan hanya mengonfirmasi sekali. Definisi RPC `update_web_booking_payment_status` tidak diubah; RPC itu tetap dipakai transaksi Midtrans lama dan transfer manual.

Booking memiliki masa tahan slot 15 menit sesuai RPC existing. Durasi checkout dihitung dari sisa masa tahan, dibulatkan ke bawah dengan margin 30 detik (maksimum 14 menit). Pemulihan checkout yang sudah kedaluwarsa dinonaktifkan. Halaman hasil membaca status server, bukan parameter status atau nominal dari callback.

Notifikasi `FAILED` bukan kegagalan seluruh Checkout: pelanggan dapat mencoba metode lain. Event non-`SUCCESS` tidak melepas slot. Status kedaluwarsa diturunkan dari `payment_expired_at` saat membaca status, seperti pengecekan ketersediaan yang sudah ada.

## Kegagalan dan pembayaran terlambat

- Penolakan checkout 4xx yang definitif melepaskan slot melalui status `payment_failed`.
- Timeout, respons ambigu, 409, 429, dan 5xx mempertahankan slot sampai kedaluwarsa; pengguna diarahkan ke halaman status. Tidak ada percobaan otomatis membuat pembayaran kedua.
- SUCCESS yang diterima setelah masa tahan slot berakhir atau status booking berubah mencatat pembayaran tetapi tidak mengambil kembali slot. Halaman pelanggan menampilkan kebutuhan konfirmasi admin.
- Cari log `DOKU payment requires booking reconciliation`, lalu cocokkan invoice pada DOKU Dashboard dengan `rentals.midtrans_order_id`. Periksa `paid_at`, `payment_method`, nominal, dan status; konfirmasi jadwal atau pengembalian dana secara manual. Daftar booking manual pada `/admin` tetap khusus bukti transfer.
- Jika response checkout hilang sebelum URL diterima, URL tersebut tidak dapat dipulihkan dari database existing. Pelanggan menunggu status/expiry atau menghubungi admin dengan invoice.
- Data pembayaran baru menggunakan struktur existing. Hak akses database existing tidak diubah dalam pekerjaan ini.

## Perpindahan dari Midtrans

Transaksi baru hanya memakai DOKU. Endpoint `/api/payment/webhook` dan verifier Midtrans dipertahankan khusus invoice lama `booking-...`. Simpan `MIDTRANS_SERVER_KEY` selama masih ada transaksi Midtrans yang harus diselesaikan. Snap, client key frontend, dan pembuatan checkout Midtrans sudah tidak dipakai.

## Validasi

```sh
node --test tests/doku-payment.test.mjs
npx tsc --noEmit
npm run lint
npm run build
```

Unit test memakai HTTP/database mock: signature, nominal, notifikasi bersamaan, FAILED, pembayaran terlambat, payload checkout, timeout, dan penolakan API. Pengujian ini tidak membuat pembayaran atau mengubah database live. Setelah deployment, cek alur pembayaran nyata dan penerimaan webhook pada domain production.

Referensi: [DOKU Backend Integration](https://developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration) dan [Notification Best Practice](https://developers.doku.com/get-started-with-doku-api/notification/best-practice).
