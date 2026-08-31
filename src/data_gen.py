"""Ring Sentinel — Track A: synthetic data generator.

Populations: legitimate identities (with ~15% power shoppers), camouflage
identities (legit + exactly one coincidental shared signal, CAMO_ prefix),
and ring identities (70 rings, sizes 3-14, four ring types).
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass

import numpy as np
import pandas as pd

START_DATE = pd.Timestamp("2026-01-01")
WINDOW_DAYS = 182

N_LEGIT = 20_000
POWER_SHOPPER_FRACTION = 0.15
N_CAMOUFLAGE = 800
N_RING_IDENTITIES = 591
N_RINGS = 70
RING_SIZE_RANGE = (3, 14)

MERCHANT_POOL_SIZE = 3_000

CATEGORY_CLAIM_RATE = {
    "ELECTRONICS": 0.22,
    "FASHION": 0.15,
    "HOME": 0.12,
    "BEAUTY": 0.08,
    "GROCERY": 0.07,
}
CATEGORY_WEIGHTS = [0.15, 0.30, 0.25, 0.15, 0.15]

RING_TYPE_DEVICE_ONLY = "DEVICE_ONLY"
RING_TYPE_VPA_ONLY = "VPA_ONLY"
RING_TYPE_ADDRESS_ONLY = "ADDRESS_ONLY"
RING_TYPE_MIXED = "MIXED"
RING_TYPES = [
    RING_TYPE_DEVICE_ONLY,
    RING_TYPE_VPA_ONLY,
    RING_TYPE_ADDRESS_ONLY,
    RING_TYPE_MIXED,
]

RING_CLAIM_PROB = 0.22
RING_APPROVAL_PROB = 0.85
LEGIT_APPROVAL_PROB = 0.62
CLAIM_DELAY_DAYS = (1, 10)

LEGIT_REASONS = [
    "Item did not fit",
    "Received wrong size",
    "Product damaged in transit",
    "Box was opened on delivery",
    "Wrong color received",
    "Item defective on arrival",
    "Accessory missing from box",
    "Changed my mind about the purchase",
    "Found a better price elsewhere",
    "Delivered too late, no longer needed",
    "Quality worse than described",
    "Allergic reaction to product",
    "Duplicate order placed by mistake",
    "Ordered by a family member without asking",
    "Package never delivered to my door",
    "Courier marked delivered but nothing received",
    "Item does not match photos",
    "Charger incompatible with my device",
    "Fabric torn after first wash",
    "Screen scratched out of the box",
    "Battery drains within an hour",
    "Shoes uncomfortable after one wear",
    "Expiry date too close to delivery",
    "Seal broken on arrival",
]

RING_REASONS = [
    "Item never arrived at my address",
    "Package showed delivered but is missing",
    "Delivery confirmed but nothing received",
]

AMOUNT_LOGNORMAL_MEAN = 6.6
AMOUNT_LOGNORMAL_SIGMA = 0.85
AMOUNT_MIN = 199.0
AMOUNT_MAX = 25_000.0


@dataclass
class Identity:
    identity_key: str
    devices: list[str]
    vpas: list[str]
    phones: list[str]
    addresses: list[str]
    cards: list[str]
    is_ring: bool = False
    ring_id: str | None = None
    is_camouflage: bool = False
    is_power_shopper: bool = False


def _pool(prefix: str, n: int) -> list[str]:
    return [f"{prefix}_{i:07d}" for i in range(n)]


class _PoolCursor:
    KINDS = ("dev", "vpa", "ph", "adr", "card")

    def __init__(self, n_base: int) -> None:
        self.pools = {
            "dev": _pool("dev", n_base * 4),
            "vpa": _pool("vpa", n_base * 2),
            "ph": _pool("ph", n_base * 2),
            "adr": _pool("adr", n_base * 2),
            "card": _pool("card", n_base * 2),
        }
        self.counters = {k: 0 for k in self.KINDS}

    def take(self, kind: str) -> str:
        v = self.pools[kind][self.counters[kind]]
        self.counters[kind] += 1
        return v


def gen_identities(rng: np.random.Generator) -> list[Identity]:
    total = N_LEGIT + N_CAMOUFLAGE + N_RING_IDENTITIES
    cur = _PoolCursor(total)
    identities: list[Identity] = []

    power_flags = rng.random(N_LEGIT) < POWER_SHOPPER_FRACTION
    for i in range(N_LEGIT):
        identities.append(
            Identity(
                identity_key=f"USR_{i:06d}",
                devices=[cur.take("dev")],
                vpas=[cur.take("vpa")],
                phones=[cur.take("ph")],
                addresses=[cur.take("adr")],
                cards=[cur.take("card")],
                is_power_shopper=bool(power_flags[i]),
            )
        )

    for j in range(N_CAMOUFLAGE):
        camo = Identity(
            identity_key=f"CAMO_{j:05d}",
            devices=[cur.take("dev")],
            vpas=[cur.take("vpa")],
            phones=[cur.take("ph")],
            addresses=[cur.take("adr")],
            cards=[cur.take("card")],
            is_camouflage=True,
        )
        donor = identities[int(rng.integers(0, N_LEGIT))]
        if rng.random() < 0.5:
            camo.devices.append(donor.devices[0])
        else:
            camo.addresses.append(donor.addresses[0])
        identities.append(camo)

    sizes: list[int] = []
    while len(sizes) < N_RINGS - 1:
        remaining_rings = N_RINGS - len(sizes) - 1
        remaining_ids = N_RING_IDENTITIES - sum(sizes)
        lo = max(RING_SIZE_RANGE[0], remaining_ids - RING_SIZE_RANGE[1] * remaining_rings)
        hi = min(RING_SIZE_RANGE[1], remaining_ids - RING_SIZE_RANGE[0] * remaining_rings)
        hi = max(hi, lo)
        sizes.append(int(rng.integers(lo, hi + 1)))
    last = N_RING_IDENTITIES - sum(sizes)
    if last > RING_SIZE_RANGE[1]:
        overflow = last - RING_SIZE_RANGE[1]
        sizes[-1] += overflow // 2
        sizes[-2] += overflow - overflow // 2
        last = RING_SIZE_RANGE[1]
    sizes.append(last)

    for r, size in enumerate(sizes):
        ring_type = RING_TYPES[r % len(RING_TYPES)]
        shares_address = ring_type in (RING_TYPE_ADDRESS_ONLY, RING_TYPE_MIXED)
        shares_vpa = ring_type in (RING_TYPE_VPA_ONLY, RING_TYPE_MIXED)
        shared_devs = [cur.take("dev")]
        if ring_type == RING_TYPE_MIXED:
            shared_devs.append(cur.take("dev"))
        shared_vpa = cur.take("vpa") if shares_vpa else None
        shared_addr = cur.take("adr") if shares_address else None
        for m in range(size):
            vpa = shared_vpa if shared_vpa is not None else cur.take("vpa")
            addr = shared_addr if shared_addr is not None else cur.take("adr")
            identities.append(
                Identity(
                    identity_key=f"RNG{r:03d}_{m:02d}",
                    devices=list(shared_devs),
                    vpas=[vpa],
                    phones=[cur.take("ph")],
                    addresses=[addr],
                    cards=[cur.take("card")],
                    is_ring=True,
                    ring_id=f"ring_{r:03d}",
                )
            )
    return identities


def gen_orders_and_claims(
    identities: list[Identity],
    merchant_categories: np.ndarray,
    rng: np.random.Generator,
    ring_claim_prob: float,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    n_merchants = len(merchant_categories)
    categories = np.array(list(CATEGORY_CLAIM_RATE.keys()))
    cat_rates = np.array([CATEGORY_CLAIM_RATE[c] for c in categories])

    order_rows: list[dict] = []
    claim_rows: list[dict] = []
    order_counter = 0
    claim_counter = 0
    ring_windows: dict[str, tuple[int, int]] = {}

    def draw_amount() -> float:
        amt = rng.lognormal(AMOUNT_LOGNORMAL_MEAN, AMOUNT_LOGNORMAL_SIGMA)
        return float(np.clip(round(float(amt), 2), AMOUNT_MIN, AMOUNT_MAX))

    def make_order(ident: Identity, day: int, merchant_idx: int) -> dict:
        nonlocal order_counter
        ts = START_DATE + pd.Timedelta(
            days=int(day),
            hours=int(rng.integers(0, 24)),
            minutes=int(rng.integers(0, 60)),
        )
        row = {
            "order_id": f"ORD_{order_counter:07d}",
            "identity_key": ident.identity_key,
            "merchant_id": f"MRC_{merchant_idx:05d}",
            "device_id": ident.devices[int(rng.integers(0, len(ident.devices)))],
            "vpa_id": ident.vpas[int(rng.integers(0, len(ident.vpas)))],
            "phone_id": ident.phones[int(rng.integers(0, len(ident.phones)))],
            "address_id": ident.addresses[int(rng.integers(0, len(ident.addresses)))],
            "card_id": ident.cards[int(rng.integers(0, len(ident.cards)))],
            "order_ts": ts,
            "amount": draw_amount(),
            "category_idx": int(merchant_categories[merchant_idx]),
            "is_ring_order": int(ident.is_ring),
        }
        order_counter += 1
        return row

    def maybe_claim(order: dict, ident: Identity) -> None:
        nonlocal claim_counter
        rate = ring_claim_prob if ident.is_ring else cat_rates[order["category_idx"]]
        if rng.random() >= rate:
            return
        delay = int(rng.integers(*CLAIM_DELAY_DAYS))
        reason = (
            RING_REASONS[int(rng.integers(0, len(RING_REASONS)))]
            if ident.is_ring
            else LEGIT_REASONS[int(rng.integers(0, len(LEGIT_REASONS)))]
        )
        approved = (
            rng.random() < RING_APPROVAL_PROB
            if ident.is_ring
            else rng.random() < LEGIT_APPROVAL_PROB
        )
        claim_rows.append(
            {
                "claim_id": f"CLM_{claim_counter:07d}",
                "order_id": order["order_id"],
                "identity_key": order["identity_key"],
                "merchant_id": order["merchant_id"],
                "category": str(categories[order["category_idx"]]),
                "claim_ts": order["order_ts"] + pd.Timedelta(days=delay),
                "amount": order["amount"],
                "reason_text": reason,
                "is_approved": int(approved),
                "is_ring_label": int(ident.is_ring),
            }
        )
        claim_counter += 1

    def ring_window(ring_id: str) -> tuple[int, int]:
        if ring_id not in ring_windows:
            start = int(rng.integers(0, WINDOW_DAYS - 21))
            ring_windows[ring_id] = (start, int(rng.integers(10, 21)))
        return ring_windows[ring_id]

    for ident in identities:
        if ident.is_ring:
            assert ident.ring_id is not None, "ring identity missing ring_id"
            start_day, window_len = ring_window(ident.ring_id)
            n_mrch = int(rng.integers(3, 9))
            merch_idx = rng.choice(n_merchants, size=n_mrch, replace=False)
            for mi in merch_idx:
                day = int(np.clip(start_day + rng.integers(0, window_len), 0, WINDOW_DAYS - 1))
                o = make_order(ident, day, int(mi))
                order_rows.append(o)
                maybe_claim(o, ident)
        else:
            if ident.is_power_shopper:
                n_mrch = int(rng.integers(3, 10))
            else:
                n_mrch = int(rng.choice([1, 2, 3], p=[0.45, 0.35, 0.20]))
            merch_idx = rng.choice(n_merchants, size=n_mrch, replace=False)
            for mi in merch_idx:
                n_orders = int(rng.integers(1, 6))
                days = rng.integers(0, WINDOW_DAYS, size=n_orders)
                for d in days:
                    o = make_order(ident, int(d), int(mi))
                    order_rows.append(o)
                    maybe_claim(o, ident)

    orders_df = pd.DataFrame(order_rows)
    claims_df = (
        pd.DataFrame(claim_rows).sort_values("claim_ts").reset_index(drop=True)
        if claim_rows
        else pd.DataFrame()
    )
    return orders_df, claims_df


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="data/")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--ring-claim-prob", type=float, default=RING_CLAIM_PROB)
    args = parser.parse_args()

    rng = np.random.default_rng(args.seed)
    identities = gen_identities(rng)

    n_legit = sum(1 for i in identities if not i.is_ring and not i.is_camouflage)
    n_camo = sum(1 for i in identities if i.is_camouflage)
    n_ring = sum(1 for i in identities if i.is_ring)
    total = len(identities)
    print(f"identities: total={total} legit={n_legit} camouflage={n_camo} ring={n_ring} "
          f"(ring share={n_ring / total:.2%})")

    merchant_categories = rng.choice(
        len(CATEGORY_CLAIM_RATE), size=MERCHANT_POOL_SIZE, p=CATEGORY_WEIGHTS
    )
    orders_df, claims_df = gen_orders_and_claims(
        identities, merchant_categories, rng, args.ring_claim_prob
    )

    pos_rate = float(claims_df["is_ring_label"].mean())
    print(f"orders={len(orders_df)} claims={len(claims_df)} "
          f"ring_claims={int(claims_df['is_ring_label'].sum())} positive_rate={pos_rate:.2%}")

    idf = pd.DataFrame(
        [
            {
                "identity_key": i.identity_key,
                "devices": "|".join(i.devices),
                "vpas": "|".join(i.vpas),
                "phones": "|".join(i.phones),
                "addresses": "|".join(i.addresses),
                "cards": "|".join(i.cards),
                "is_ring": int(i.is_ring),
                "ring_id": i.ring_id,
                "is_camouflage": int(i.is_camouflage),
                "is_power_shopper": int(i.is_power_shopper),
            }
            for i in identities
        ]
    )
    os.makedirs(args.out, exist_ok=True)
    idf.to_parquet(os.path.join(args.out, "identities.parquet"), index=False)
    orders_df.to_parquet(os.path.join(args.out, "orders.parquet"), index=False)
    claims_df.to_parquet(os.path.join(args.out, "claims.parquet"), index=False)
    print(f"wrote identities/orders/claims parquet to {args.out}")

    ok = 0.01 <= pos_rate <= 0.05
    print(f"A.3 acceptance: positive rate {'OK' if ok else 'OUT OF RANGE'} (target 1%-5%)")
    print(f"A.1 acceptance: ring identity share "
          f"{'OK' if 0.02 <= n_ring / total <= 0.04 else 'CHECK'}")


if __name__ == "__main__":
    main()
