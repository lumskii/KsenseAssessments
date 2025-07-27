# Patient‑Risk Scoring Assessment

## Purpose

This repository demonstrates my ability to integrate with a **real‑world, non‑deterministic healthcare API** and to build a resilient data‑processing pipeline that:

1. Retrieves paginated patient data while handling rate‑limits, transient 5xx errors, and inconsistent response shapes.
2. Calculates a composite **risk score** (blood‑pressure, temperature, age) exactly per the rubric provided in the brief.
3. Produces three alert lists (high‑risk, fever, data‑quality issues), then submits them back to the platform.
4. Prints a full JSON grading report for invigilators to verify.

## Folder Layout

```
├─ index.ts        → main script (all logic)
├─ package.json    → dependencies and scripts
├─ .env            → local environment configuration
└─ README.md       → this file
```

## Prerequisites

* **Node 20+** (ESM‑friendly)
* **npm 9+**
* (optional) A [Cloudflare account](https://dash.cloudflare.com/) if you prefer the proxy method for secret handling

## Installation

```bash
npm install            # installs axios, bottleneck, p-retry, tsx, etc.
```

## Configuration

### Option A – Direct (.env) **← simplest for local grading**

Create a file named `.env` at the repo root with your credentials:

```
BASE_URL=https://assessment.kensetech.com/api
X_API_KEY=your‑real‑key
```

Run `npm start` and you're done.

### Option B – Cloudflare Worker proxy (key never leaves CF)

If you have a Cloudflare Worker proxy deployed, set:

```
CF_PROXY_URL=https://your-worker.workers.dev/api
```

The script will automatically detect the missing direct credentials and route through the proxy. Additionally, I have added a fallback to the proxy URL in case the direct API key is not available.

---

## Running the Assessment

```bash
npm start             # alias for "tsx index.ts"
```

The console will show:

1. **Environment detection**: Whether using direct API or proxy
2. **Progress indicators**: Retry attempts and API calls
3. **Summary table**: Counts of `high‑risk`, `fever`, `bad data` patients
4. **Patient ID arrays**: The exact lists for each category
5. **API response**: Pretty‑printed grading JSON, e.g.

   ```json
   {
     "success": true,
     "message": "Assessment submitted successfully",
     "results": { ... }
   }
   ```
6. **Completion**: The tick `✅ Assessment submitted`

### Typical runtime

| Stage                    | Notes                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| **Fetch paginated data** | Retries on 429 / 5xx, normalises payload drift                     |
| **Score & build lists**  | Pure in‑memory transformation                                      |
| **Submit lists**         | Exactly one POST; *never* retries on 4xx to preserve attempt quota |

A run against the sample dataset usually finishes in **< 10 seconds**.

---

## Key Implementation Details

### Technology Stack
* **TypeScript (ESM)** executed via [`tsx`](https://github.com/esbuild-kit/tsx) for zero‑config TS running
* **Axios** for HTTP client with interceptors
* **Bottleneck** for rate limiting (≤ 3 req/s)
* **p-retry** with AbortError for intelligent retry logic
* **dotenv** for environment configuration

### Resilience Features
* **Smart retries**: Only retries transient errors (429, 5xx, network issues)
* **Rate limiting**: Automatic throttling to respect API limits
* **Format handling**: Gracefully handles API response variations (`data` vs `patients` arrays)
* **Error categorization**: Distinguishes between retryable and fatal errors

### Risk Scoring Algorithm

The system calculates a composite risk score based on three factors:

#### Blood Pressure Scoring (0-3 points)
- **0 points**: Normal (< 120/80)
- **1 point**: Elevated (120-129 / < 80)
- **2 points**: Stage 1 Hypertension (130-139 / 80-89)
- **3 points**: Stage 2 Hypertension (≥ 140/90)

#### Temperature Scoring (0-2 points)
- **0 points**: Normal (< 99.6°F)
- **1 point**: Low fever (99.6-100.9°F)
- **2 points**: High fever (≥ 101.0°F)

#### Age Scoring (0-2 points)
- **0 points**: Young adult (< 40 years)
- **1 point**: Middle-aged (40-65 years)
- **2 points**: Elderly (> 65 years)

### Alert Categories
- **High Risk**: Combined score ≥ 4 points
- **Fever**: Temperature ≥ 99.6°F (regardless of other factors)
- **Data Quality Issues**: Missing or invalid vital signs

---

## Error Handling

The system implements sophisticated error handling:

```typescript
// Only retry transient errors
function isTransient(e: unknown): boolean {
  if (!axios.isAxiosError(e) || !e.response) return true; // network/timeout
  const s = e.response.status;
  return s === 429 || s === 500 || s === 502 || s === 503;
}
```

- **Network errors**: Always retried (connectivity issues)
- **429 (Rate Limited)**: Retried with exponential backoff
- **5xx (Server errors)**: Retried as transient issues
- **4xx (Client errors)**: Never retried to preserve attempt quota

---

## Common Issues & Fixes

| Symptom                                | Cause                                                                        | Fix                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `MODULE_TYPELESS_PACKAGE_JSON` warning | Node sees ESM but `package.json` wasn't marked                               | Already solved by "type": "module" in `package.json`                      |
| `400 Maximum attempts reached`         | Assessment platform counts every submit; previous runs consumed your 3 slots | Ask the grader to reset the quota or issue a fresh key, then rerun        |
| Rate limit warnings                    | API temporarily throttling requests                                          | Built-in rate limiting handles this automatically                          |
| Network timeouts                       | Connectivity issues                                                          | Automatic retries with exponential backoff                                |

---

## Development Notes

### Code Structure
The application follows a functional pipeline approach:

1. **Environment setup**: Detects direct vs proxy configuration
2. **HTTP client configuration**: Sets up axios with headers and base URL
3. **Data fetching**: Paginated retrieval with format normalization
4. **Risk assessment**: Pure functions for scoring and categorization
5. **Submission**: Single POST with comprehensive error handling

### Security Considerations
- API keys can be kept server-side using Cloudflare Worker proxy
- No sensitive data logged to console
- Environment variables used for all configuration

### Performance Optimizations
- Efficient pagination handling
- Minimal memory footprint for large datasets
- Rate limiting prevents API overwhelm
- Intelligent retry logic reduces unnecessary requests

---

## Dependencies

```json
{
  "dependencies": {
    "axios": "^1.11.0",      // HTTP client
    "bottleneck": "^2.19.5", // Rate limiting
    "dotenv": "^17.2.1",     // Environment variables
    "p-retry": "^6.2.1"      // Intelligent retries
  },
  "devDependencies": {
    "@types/node": "^24.1.0", // Node.js types
    "tsx": "^4.19.2",          // TypeScript execution
    "typescript": "^5.8.3"     // TypeScript compiler
  }
}
```

---

## Contact / Questions

If anything doesn't run as expected, please refer to the error handling section above or check the console output for specific error messages. The system provides detailed logging to help diagnose any issues.
