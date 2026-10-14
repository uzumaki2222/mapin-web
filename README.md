# mapin

Launchpad di peta dunia, di Robinhood Chain (chainId 4663). Website: https://mapinpad.fun

Klik sebuah negara, lalu luncurkan dan perdagangkan tokennya. Setiap negara dipasangkan dengan **token mata uangnya sendiri**:

| Lapisan | Contoh | Pair |
|---|---|---|
| Token mata uang | $DZD (Algerian Dinar), $MYR, $GBP, $EUR | dengan ETH |
| Token negara | $ALGERIA, $MALAYSIA, $UK, $FRANCE | dengan token mata uangnya ($DZD, $MYR, $GBP, $EUR) |

- Token mata uang adalah **token bertema dengan harga pasar bebas**. Token ini bukan stablecoin dan nilainya tidak sama dengan mata uang aslinya.
- Satu token per negara dan satu token per mata uang. Siapa pun boleh meluncurkan, dan peluncur pertama mendapat creator fee (0–1%) dari setiap transaksi.
- Pembeli cukup memakai ETH. Untuk token negara, `buyWithETH` dan `sellForETH` otomatis lewat dua curve (ETH ↔ $DZD ↔ $ALGERIA) dalam satu transaksi.
- Supply setiap token 1 miliar. Sebanyak 80% dijual di bonding curve. Saat penuh, token lulus dan owner memindahkan dana serta 20% token cadangan ke pool DEX (`migrate`).
- Biaya platform 1% per curve, ditambah creator fee.

## 1. Deploy kontrak (sekali, dari wallet kamu)

```bash
cd contracts
npm install
npx hardhat test                    # semua test harus lulus
cp .env.example .env                # isi DEPLOYER_PRIVATE_KEY (wallet dengan sedikit ETH di Robinhood Chain)
npm run deploy:mainnet
```

Script ini:
- Men-deploy `MapinLaunchpad` dengan WETH Robinhood Chain (`0x0Bd7…AD73`).
- Mendaftarkan 244 negara beserta mata uangnya.
- Menulis alamat kontrak ke `lib/contracts/mapin-deployment.json`. Commit file itu supaya website memakainya.

Setelah deploy, pindahkan ownership ke multisig (Safe) lewat `transferOwnership`, lalu panggil `acceptOwnership` dari Safe.

> Kontrak ini belum diaudit. Audit dulu sebelum menampung dana besar.

## 2. Website (Vercel)

Isi environment variable berikut di Vercel → Settings → Environment Variables:

| Variabel | Isi |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://mapinpad.fun` |
| `NEXT_PUBLIC_PRIVY_APP_ID` | `cmv5o98fj001r0fii3w55e3r9` (sudah jadi default) |
| `NEXT_PUBLIC_MAPIN_LAUNCHPAD` | alamat MapinLaunchpad. Opsional kalau `mapin-deployment.json` sudah di-commit |
| `ROBINHOOD_RPC_URL` | disarankan RPC privat (Alchemy, dll.) untuk relay `/api/rpc` |

Lalu:
- **Privy dashboard** → app → Settings → Allowed domains: tambahkan `https://mapinpad.fun` dan `https://www.mapinpad.fun`.
- **Vercel** → Settings → Domains: tambahkan `mapinpad.fun`, lalu arahkan DNS sesuai petunjuk Vercel.

Halaman utama (`/`) adalah peta negara (`components/countries`). Halaman lama berbasis Pons (`/explore`, `/b/...`, `/tokenize/...`) masih ada di kode, tapi sudah tidak ditautkan dari menu.

## Struktur

| Path | Isi |
|---|---|
| `contracts/` | Kontrak Solidity, test Hardhat, script deploy, daftar negara dan mata uang |
| `components/countries/` | Peta negara, panel negara, form launch, beli dan jual |
| `lib/contracts/mapin-abi.ts` | ABI dan alamat MapinLaunchpad |
| `lib/countries/places.json` | 244 negara, mata uang, dan kurs referensi (untuk tampilan saja) |
| `public/world.geo.json` | Batas negara (dari mledoze/countries, disederhanakan) |
