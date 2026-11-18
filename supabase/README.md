# CASA Showcase — Supabase + Telegram Moderation Setup

Panduan deploy backend **Ratings & Reviews** untuk showcase web CASA (`https://farhanpratama09.github.io/casa-app/`).

> **Penting:** Jangan pernah menempel *bot token*, `service_role` key, maupun `IP_HASH_SALT` ke kode sumber Git atau langsung ke perintah terminal tanpa input interaktif (`Read-Host -AsSecureString`), agar riwayat shell (`PSReadLine`) tetap bersih.

---

## 1. Jalankan Migrasi SQL
1. Buka **Supabase Dashboard → SQL Editor** pada proyek `ivlyujaafwqziogajjtk`.
2. Salin seluruh isi [001_casa_reviews.sql](./migrations/001_casa_reviews.sql) lalu klik **Run**.
3. Pastikan kedua view publik berikut tercipta (hanya ini yang dapat dibaca oleh role `anon` menggunakan *Publishable key*):
   - `public.casa_reviews_public`
   - `public.casa_review_stats`
   - Tabel dasar `public.casa_reviews` dan `public.review_rate_limits` terkunci ketat oleh RLS.

---

## 2. Set Secrets Edge Functions (Aman di Memori PowerShell)
Login dan tautkan proyek Supabase:
```powershell
supabase login
supabase link --project-ref ivlyujaafwqziogajjtk
```

Jalankan blok PowerShell ini untuk memasukkan seluruh secret **tanpa mencetak atau menyimpan token di riwayat command shell**:

```powershell
function Read-PlainSecret([string]$Prompt) {
  $sec = Read-Host -Prompt $Prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

$tgToken   = Read-PlainSecret "TELEGRAM_BOT_TOKEN (dari @BotFather)"
$tgAdminId = Read-Host "TELEGRAM_ADMIN_CHAT_ID (ID Telegram numerik kamu)"
$tgSecret  = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 })) -replace '[+/=]','x'
$ipSalt    = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 })) -replace '[+/=]','k'

supabase secrets set `
  "TELEGRAM_BOT_TOKEN=$tgToken" `
  "TELEGRAM_ADMIN_CHAT_ID=$tgAdminId" `
  "TELEGRAM_WEBHOOK_SECRET=$tgSecret" `
  "IP_HASH_SALT=$ipSalt"

Write-Host "Secrets tersimpan di Supabase. Lanjutkan ke langkah Deploy & Set Webhook sebelum menutup sesi ini (karena `$tgToken & `$tgSecret ada di memori sesi)."
```

> Catatan: `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` disuntikkan otomatis oleh runtime Supabase ke Edge Functions (`Deno.env.get(...)`). Opsional: tambahkan `MAX_REVIEWS_PER_HOUR=25` bila ingin mengatur batas global notifikasi Telegram per jam.

---

## 3. Deploy Kedua Edge Functions
Kedua fungsi sudah ditandai `verify_jwt = false` di [config.toml](./config.toml) karena form publik memakai *Publishable key* generasi baru (`sb_publishable_...`) dan Telegram Webhook memakai verifikasi header `X-Telegram-Bot-Api-Secret-Token`:

```powershell
supabase functions deploy submit-review --no-verify-jwt
supabase functions deploy telegram-webhook --no-verify-jwt
```

---

## 4. Daftarkan Webhook Telegram (Secret Header Terproteksi)
Masih di sesi PowerShell yang sama (selama variabel `$tgToken` dan `$tgSecret` masih berada di memori), daftarkan webhook tanpa mencetak URL token:

```powershell
$webhookUrl = "https://ivlyujaafwqziogajjtk.supabase.co/functions/v1/telegram-webhook"
$tgApiUrl = "https://api.telegram.org/bot$tgToken/setWebhook"
$body = @{
  url = $webhookUrl
  secret_token = $tgSecret
  allowed_updates = @("message", "callback_query")
} | ConvertTo-Json

$res = Invoke-RestMethod -Method Post -Uri $tgApiUrl -ContentType "application/json" -Body $body
$res | Format-List

# Bersihkan variabel rahasia dari memori setelah selesai
Remove-Variable tgToken, tgSecret, ipSalt -ErrorAction SilentlyContinue
```

---

## 5. Sambungkan Publishable Key ke Web (`docs/app.js`)
1. Buka **Supabase Dashboard → Project Settings → API Keys**.
2. Salin **`Publishable key`** (format `sb_publishable_...` — **jangan pernah** menaruh `Secret key` / `service_role` di file klien).
3. Isi konstanta `SUPABASE_PUBLISHABLE_KEY` pada bagian atas `docs/app.js`:
   ```js
   const SUPABASE_URL = 'https://ivlyujaafwqziogajjtk.supabase.co';
   const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_...';
   ```
   *(Frontend hanya mengirim key tersebut melalui header `apikey`, bukan `Authorization: Bearer`, sehingga sepenuhnya kompatibel dengan format key terbaru Supabase.)*
4. Commit & push pembaruan key publik tersebut agar aktif di GitHub Pages.

---

## 6. Panduan Moderasi Admin di Telegram
- **Tombol `[ ✅ Approve ]`:** Mengubah status menjadi `approved` sehingga langsung tayang di web, lalu menyisakan tombol `[ 🗑️ Hapus dari Web ]`.
- **Tombol `[ 🗑️ Tolak ]` / `[ 🗑️ Hapus dari Web ]`:** Mengubah status menjadi `rejected` (*soft reject*, disembunyikan dari publik namun jejak rate-limit tetap tersimpan di `review_rate_limits`).
- **Quick Reply `Creator`:** Balas (*Reply*) langsung pesan notifikasi bot untuk menyimpan jawaban resmi **`Creator`**. **Perhatian:** Membalas pesan notifikasi di Telegram **otomatis menyetujui (`approved`)** dan menayangkan ulasan tersebut beserta balasan Anda ke web.

---

## 7. Uji Logika Anti-Spam Lokal (Tanpa Deno)
Jalankan unit test Node.js yang memvalidasi `spam.ts` dan `_shared/helpers.ts`:
```powershell
node scripts/verify-reviews-security.mjs
```
