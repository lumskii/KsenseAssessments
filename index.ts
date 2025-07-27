import axios, { AxiosError } from "axios";
import Bottleneck from "bottleneck";
import pRetry, { AbortError } from "p-retry";
import "dotenv/config";

/* ─────────────────────────────
   Env
───────────────────────────── */
const DIRECT_BASE = process.env.BASE_URL;
const DIRECT_KEY = process.env.X_API_KEY;

const CF_PROXY = process.env.CF_PROXY_URL ?? "https://ksense-assessment.lumi8866.workers.dev/api";

const USING_DIRECT = Boolean(DIRECT_BASE && DIRECT_KEY);

const BASE_URL = USING_DIRECT ? DIRECT_BASE! : CF_PROXY;
const DEFAULT_HEADERS = USING_DIRECT ? { "x-api-key": DIRECT_KEY! } : {};

console.log(
  USING_DIRECT
    ? "🔑  Using .env credentials (direct hit on upstream API)"
    : "🛡  Using Cloudflare Worker proxy (key stays server‑side)"
);

/* ─────────────────────────────
   Axios client + simple rate‑limit
───────────────────────────── */
const client = axios.create({
  baseURL: BASE_URL,
  headers: DEFAULT_HEADERS,
});
const limiter = new Bottleneck({ minTime: 350 }); // ≈3 req/s

/* ─────────────────────────────
   safeCall → retries only network / 429 / 5xx
───────────────────────────── */
function isTransient(e: unknown): boolean {
  if (!axios.isAxiosError(e) || !e.response) return true; // network / timeout
  const s = e.response.status;
  return s === 429 || s === 500 || s === 502 || s === 503;
}

const safeCall = <T>(fn: () => Promise<T>) =>
  limiter.schedule(() =>
    pRetry(
      () =>
        fn().catch((err) => {
          if (isTransient(err)) throw err;
          throw new AbortError(err); // abort on 4xx
        }),
      {
        retries: 5,
        factor: 2,
        onFailedAttempt: (e) =>
          console.warn(`retry #${e.attemptNumber} after error: ${e.message}`),
      }
    )
  );

/* ─────────────────────────────
   Scoring helpers
───────────────────────────── */
const parseBP = (bp?: unknown): [number | null, number | null] => {
  if (typeof bp !== "string") return [null, null];
  const m = bp.match(/^(\d+)\s*\/\s*(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : [null, null];
};

const bpScore = (s: number | null, d: number | null) =>
  s == null || d == null
    ? 0
    : s >= 140 || d >= 90
    ? 3
    : s >= 130 || d >= 80
    ? 2
    : s >= 120 && d < 80
    ? 1
    : 0;

const tempScore = (t?: unknown) =>
  !isFinite(Number(t)) ? 0 : Number(t) >= 101 ? 2 : Number(t) >= 99.6 ? 1 : 0;

const ageScore = (a?: unknown) =>
  !isFinite(Number(a)) ? 0 : Number(a) > 65 ? 2 : Number(a) >= 40 ? 1 : 0;

/* ─────────────────────────────
   Fetch all patients (handles format drift)
───────────────────────────── */
type Patient = {
  patient_id: string;
  blood_pressure?: string;
  temperature?: number;
  age?: number;
};

async function fetchAllPatients(): Promise<Patient[]> {
  let page = 1;
  const out: Patient[] = [];

  while (true) {
    const res = await safeCall(() =>
      client.get("/patients", { params: { page, limit: 20 } })
    );

    const body: any = res.data;
    const batch: Patient[] = Array.isArray(body.data)
      ? body.data
      : Array.isArray(body.patients)
      ? body.patients
      : (() => {
          throw new Error(`Unrecognised payload on page ${page}`);
        })();

    const pageInfo = body.pagination ?? body.pageInfo ?? {};
    const hasNext = pageInfo.hasNext ?? pageInfo.next != null;

    out.push(...batch);
    if (!hasNext) break;
    page++;
  }
  return out;
}

/* ─────────────────────────────
   Build alert lists
───────────────────────────── */
function buildAlerts(patients: Patient[]) {
  const highRisk: string[] = [];
  const fever: string[] = [];
  const badData: string[] = [];

  for (const p of patients) {
    const [sys, dia] = parseBP(p.blood_pressure);
    const risk = bpScore(sys, dia) + tempScore(p.temperature) + ageScore(p.age);

    const invalid =
      sys == null ||
      dia == null ||
      !isFinite(Number(p.temperature)) ||
      !isFinite(Number(p.age));

    if (risk >= 4) highRisk.push(p.patient_id);
    if (Number(p.temperature) >= 99.6) fever.push(p.patient_id);
    if (invalid) badData.push(p.patient_id);
  }
  return { highRisk, fever, badData };
}

/* ─────────────────────────────
   Submit once & pretty‑print response
───────────────────────────── */
async function submitOnce(lists: {
  highRisk: string[];
  fever: string[];
  badData: string[];
}) {
  const res = await client.post("/submit-assessment", {
    high_risk_patients: lists.highRisk,
    fever_patients: lists.fever,
    data_quality_issues: lists.badData,
  });

  console.log("\n===== API RESPONSE =====");
  console.log(JSON.stringify(res.data, null, 2));
  console.log("===== END RESPONSE =====\n");

  console.log("✅  Assessment submitted");
}

/* ─────────────────────────────
   Bootstrap
───────────────────────────── */
(async () => {
  try {
    const patients = await fetchAllPatients();
    const lists = buildAlerts(patients);

    console.table({
      "high‑risk": lists.highRisk.length,
      "fever": lists.fever.length,
      "bad data": lists.badData.length,
    });

    console.log("High‑risk IDs:", lists.highRisk);
    console.log("Fever IDs:   ", lists.fever);
    console.log("Bad‑data IDs:", lists.badData);

    await submitOnce(lists);
  } catch (err) {
    const e = err as AxiosError;
    console.error("❌  Fatal:", e.message, e.response?.data);
    process.exit(1);
  }
})();
