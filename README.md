# Trend Pulse 📈

> Sub-hourly Google Trends data fetcher with **gtrendsR loop-based aggregation**, 30-min resolution, and export to **Excel**, **Stata (.dta)**, **CSV**, and **R scripts**.

## Deploy to Vercel

### Option A — One-click (fastest)

1. Push this folder to a new GitHub repo
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import the repo — Vercel auto-detects Next.js — Click **Deploy**

### Option B — CLI

```bash
npm install
npx vercel --prod
```

## Local Dev

```bash
npm install
npm run dev
```

## Features

- Simulated trend data with realistic daily/weekly cycles
- Interactive Recharts area chart with zoom brush
- Sortable, paginated data table
- Export: CSV, Excel (.xlsx), R script (gtrendsR loop), Stata (.do + .csv)
- 20+ country/region filter
- 8 frequency options (1min to weekly)

## Author

[Ali Awais Khalid](https://github.com/AliAwaisKhalid)
