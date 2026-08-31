import { api } from "../../lib/api";
import type { ScoreResponse } from "../../types";

export interface MemberResult {
  member: number;
  identity: string;
  merchant: string;
  amount: number;
  res: ScoreResponse;
}

const REASONS_LEGIT = [
  "Item did not fit",
  "Product damaged in transit",
  "Changed my mind about the purchase",
];
const REASON_RING = "Item never arrived at my address";

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export async function runScenarioLegit(
  onResult: (r: MemberResult) => void,
  isCancelled: () => boolean,
): Promise<void> {
  const customers = [
    ["USR_DEMO_A", "MRC_DEMO_1", 2450],
    ["USR_DEMO_B", "MRC_DEMO_2", 1180],
    ["USR_DEMO_C", "MRC_DEMO_3", 6799],
  ] as const;
  for (let i = 0; i < customers.length; i++) {
    if (isCancelled()) return;
    const c = customers[i];
    if (!c) continue;
    const [ident, merch, amount] = c;
    await api.ingestOrder({
      order_id: `ORD_${ident}_${Date.now()}`,
      identity_key: ident,
      merchant_id: merch,
      device_id: `dev_${ident}`,
      vpa_id: `vpa_${ident}`,
      phone_id: `ph_${ident}`,
      address_id: `adr_${ident}`,
      card_id: `card_${ident}`,
    });
    const res = await api.scoreClaim({
      claim_id: `CLM_${ident}_${Date.now()}`,
      identity_key: ident,
      merchant_id: merch,
      amount,
      reason_text: REASONS_LEGIT[i] ?? "Item arrived damaged",
      approved: true,
    });
    onResult({ member: i + 1, identity: ident, merchant: merch, amount, res });
    await sleep(700);
  }
}

export async function runScenarioRing(
  onResult: (r: MemberResult) => void,
  isCancelled: () => boolean,
): Promise<void> {
  const sharedDevices = ["dev_ring_shared_A", "dev_ring_shared_B"];
  const sharedVpa = "vpa_ring_shared_S";
  for (let i = 1; i <= 8; i++) {
    if (isCancelled()) return;
    const ident = `RNGDEMO_M${i}`;
    const merch = `MRC_RING_D${i}`;
    const amount = 3000 + i * 777;
    await api.ingestOrder({
      order_id: `ORD_${ident}_${Date.now()}`,
      identity_key: ident,
      merchant_id: merch,
      device_id: sharedDevices[i % 2] ?? sharedDevices[0] ?? `dev_${ident}`,
      vpa_id: sharedVpa,
      phone_id: `ph_${ident}`,
      address_id: `adr_${ident}`,
      card_id: `card_${ident}`,
    });
    const res = await api.scoreClaim({
      claim_id: `CLM_${ident}_${Date.now()}`,
      identity_key: ident,
      merchant_id: merch,
      amount,
      reason_text: REASON_RING,
      approved: true,
    });
    onResult({ member: i, identity: ident, merchant: merch, amount, res });
    await sleep(900);
  }
}

export async function runScenarioBatch(
  onResult: (r: MemberResult) => void,
  isCancelled: () => boolean,
): Promise<void> {
  const sharedDev = "dev_batch_cluster";
  const sharedVpa = "vpa_batch_cluster";
  for (let i = 1; i <= 16; i++) {
    if (isCancelled()) return;
    const ident = `BATCH_M${i}`;
    const merch = `MRC_BATCH_${(i % 4) + 1}`;
    const amount = 1500 + i * 450;
    await api.ingestOrder({
      order_id: `ORD_${ident}_${Date.now()}`,
      identity_key: ident,
      merchant_id: merch,
      device_id: i <= 12 ? sharedDev : `dev_${ident}`,
      vpa_id: i <= 12 ? sharedVpa : `vpa_${ident}`,
      phone_id: `ph_${ident}`,
      address_id: `adr_${ident}`,
      card_id: `card_${ident}`,
    });
    const res = await api.scoreClaim({
      claim_id: `CLM_${ident}_${Date.now()}`,
      identity_key: ident,
      merchant_id: merch,
      amount,
      reason_text: "Item defective",
      approved: true,
    });
    onResult({ member: i, identity: ident, merchant: merch, amount, res });
    await sleep(40);
  }
}
