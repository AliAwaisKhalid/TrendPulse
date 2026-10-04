# Trend Pulse

Google Trends fetcher for research use, with export to **Excel**, **Stata (.do + CSV)**, **CSV** and **R scripts**, and built-in diagnostics for the resolution and stitching problems described below.

## Read this before using the data for inference

1. **Google Trends is about hourly at best.** For windows of up to roughly 7 days it returns hourly values. A 30-minute (or finer) series built from it contains no new information: values are repeated or interpolated between hourly points. That inflates short-lag autocorrelation and shrinks the effective sample, so Granger-causality and VAR tests look more significant than they are. The app therefore defaults to **1 hour (native)**, warns when a finer grid is chosen, and flags interpolated rows (`interpolated = 1` in exports).
2. **Windows are scaled separately.** Google scales every request to 0-100 on its own. Longer ranges are built from 7-day windows with a 6-hour overlap, chain-rescaled on the overlap, then renormalised. This is a heuristic. It is only credible if it agrees with an independent benchmark, so the app can compare the stitched series, averaged to days, with the standard daily series for the same keyword, region and period, and report correlation in levels and changes, the mean error after scaling, per-seam scale factors and overlap correlations, and the agreement between two separate downloads of the first window (Google samples its data, so repeat requests differ).
3. **Simulated fallback.** If Google blocks a request, the app substitutes simulated data. Those rows carry `simulated = 1` in exports and the page shows a warning banner. Never analyse them as real data.

4. **Noise and sparsity (Reviewer 2, comment 2.4).** Before any PCA, the app tabulates for each raw keyword series the zero share, share of values at or below 5, longest run of zeros, coefficient of variation and lag-1 autocorrelation, with a flag for sparse (more than 30% zeros) or spiky (CV above 1.5) series. A **PC1 composition** panel shows how much of the first component comes from each query category (sum of squared loadings against the equal-weight share), so generic location queries can be compared with commercial shipping queries. Both are in the Excel export (Diagnostics and "PC1 by category" sheets).

5. **Resolution comparison tab.** With the validation box ticked (date range 8 to 260 days), a "Resolutions" tab compares the same keyword at 30-minute, hourly and daily resolution: correlations in levels and in changes with Fisher 95% confidence intervals, shown both treating observations as independent and adjusted for autocorrelation (AR(1) effective sample size); a plot of daily means by resolution with 95% bands; and a rolling 14-day correlation with the daily benchmark and its confidence band. The 30-minute series is interpolated from hourly data, so its agreement with the hourly series is by construction. Results export as `resolution_comparison.csv`.

The diagnostics table reports, per keyword: native and output step, rows per native observation, share of identical consecutive values, lag-1 autocorrelation before and after resampling, and an AR(1) effective sample size. The effective sample size is an approximation, not a replacement for a proper test. For Granger tests use the native hourly series (or coarser) and report the diagnostics file.

## Keyword import and the Strait of Hormuz study preset

- **Bulk add** and **Import file** accept a plain list (comma or newline separated) or a two-column `keyword,category` file (CSV, TSV or pasted table, header optional). Categories are shown on the keyword chips and carried into every export (`category` column, R `keyword_category` vector, Excel Diagnostics sheet).
- The **Strait of Hormuz (Table 2)** preset loads the 11 study keywords with their categories. The same list can be downloaded from the app as `hormuz_keywords_table2.csv` and re-imported.

| Keyword | Category |
|---|---|
| Strait of Hormuz | Geopolitical / Location |
| Hormuz blockade | Geopolitical / Blockade |
| Hormuz closure | Geopolitical / Blockade |
| Hormuz blocked | Geopolitical / Blockade |
| Hormuz shipping | Shipping / Trade |
| Persian Gulf shipping | Shipping / Trade |
| Persian Gulf blockade | Geopolitical / Blockade |
| Gulf oil shipping | Shipping / Oil Trade |
| Hormuz tanker | Shipping / Oil Trade |
| Iran Strait of Hormuz | Geopolitical / Location |
| Hormuz oil supply | Shipping / Oil Trade |

## Exports

CSV and Excel (columns include `category`, `interpolated`, `simulated`), an R script (gtrendsR loop with the caveats above), a Stata `.do` + CSV, a Word report, PCA scores, and a **Diagnostics** CSV (also an Excel sheet, plus Seams and Daily benchmark sheets when available).

## Local development and deployment

```bash
npm install
npm run dev
```

Deploy with `npx vercel --prod`, or push to a GitHub repository connected to Vercel.

## Limitations

- Google Trends values are sampled and rescaled; two downloads of the same query can differ.
- The daily benchmark is available for ranges of 8 to 260 days. Weekly benchmarks are not implemented.
- Screening thresholds in the diagnostics (levels correlation 0.90, changes correlation 0.50) are heuristics, not statistical tests.

## Author

[Ali Awais Khalid](https://github.com/AliAwaisKhalid)
