"""Step 5: demand flexibility + behind-the-meter battery (BTM BESS) opportunity analysis.

Battery (program spec): 2 x Enphase IQ Battery 10C = 20.16 kWh, 7.68 kW continuous, RTE 89.4 %.
We keep a 10 % backup reserve -> 18.14 kWh deliverable per daily cycle (assumption, configurable).

Two dispatch modes are simulated hour by hour for every customer and every day (vectorised):

  Mode A  "customer peak shaving"   (service / transformer headroom, electrification enablement)
          theta_d = min theta  s.t.  sum_h max(0, L_dh - theta) <= E   and   max_h L_dh - theta <= P
          discharge D_dh = min(P, max(0, L_dh - theta_d)); recharge E/eta in the lowest-load hours
          (water-filling, never above theta_d).
  Mode B  "utility peak window"     (system capacity relief, TOU bill savings)
          discharge in the peak window HE16-20 (3-8 pm), highest-load hours first, D <= min(P, L) (no export),
          sum D <= E; recharge overnight / from solar surplus.

Demand-flexible technologies (no battery) are quantified at the system top-100 hours:
  EV managed charging  = EV charging load observed at system peak hours (rise above rolling floor > 3 kW)
  Smart thermostat     = 30 % of estimated AC kW (summer peak) / heat-pump kW (winter)
  Pool-pump schedule   = pool kW if the pump block overlaps the peak window
  Water-heater control = 0.4 kW
"""
import numpy as np, pandas as pd
from numpy.lib.stride_tricks import sliding_window_view as swv

E_NOM, P_MAX, RTE, RESERVE = 20.16, 7.68, 0.894, 0.10
PEAK_WINDOW = np.arange(15, 20)          # HE16-20 (index = HE-1)
DATES = pd.date_range("2025-09-01", periods=365)
MONTH = DATES.month.values
TOU_PEAK_MONTHS = np.isin(MONTH, [12, 1, 2, 6, 7, 8])    # NYSEG SC12 has peak pricing in these months
PRICE_PEAK, PRICE_OFF = 0.16, 0.09                     # NYSEG SC12 12-month avg supply $/kWh (peak, off-peak)
# $/kW-yr avoided capacity: NYSEG distribution MCOS $26.02 (system average, secondary, 2025 MCOS study)
# + generation capacity ~ $48 (NYISO rest-of-state summer price $8/kW-month x 6 months, May 2026).
# Capacity-constrained areas: $70.61 + $48 = $119 (reported as an upper case, not used in the ranking).
CAPACITY_VALUE = 74.0
CAPACITY_VALUE_CONSTRAINED = 119.0
SERVICE_LIMIT_KVA = 3.0                                # incremental load allowed on 200 A service w/o evaluation


def shave_threshold(L, E, P, iters=40):
    """L [..., 24] -> theta [...] minimising the daily peak under energy E and power P limits."""
    lo = np.maximum(L.max(-1) - P, 0.0)
    hi = L.max(-1)
    for _ in range(iters):
        mid = (lo + hi) / 2
        need = np.maximum(L - mid[..., None], 0).sum(-1)
        ok = need <= E
        hi = np.where(ok, mid, hi)
        lo = np.where(ok, lo, mid)
    return np.maximum(hi, L.max(-1) - P)


def water_fill(L, C, cap, P, iters=40):
    """Charge C kWh into the lowest-load hours: level phi with sum min(P, max(0, phi - L)) = C, phi <= cap."""
    lo = L.min(-1); hi = cap
    for _ in range(iters):
        mid = (lo + hi) / 2
        got = np.minimum(P, np.maximum(mid[..., None] - L, 0)).sum(-1)
        big = got >= C
        hi = np.where(big, mid, hi); lo = np.where(big, lo, mid)
    return np.minimum(P, np.maximum(hi[..., None] - L, 0))


def mode_a(L, E, P):
    th = shave_threshold(L, E, P)
    D = np.minimum(P, np.maximum(L - th[..., None], 0))
    Ch = water_fill(L, D.sum(-1) / RTE, th, P)
    return L - D + Ch, D


def mode_b(L, E, P):
    W = L[..., PEAK_WINDOW]
    order = np.argsort(-W, axis=-1)
    Ws = np.take_along_axis(W, order, -1)
    cap = np.minimum(P, Ws)
    cum = np.cumsum(cap, -1)
    take = np.clip(E - (cum - cap), 0, cap)
    D_sorted = take
    Dw = np.zeros_like(W)
    np.put_along_axis(Dw, order, D_sorted, -1)
    D = np.zeros_like(L)
    D[..., PEAK_WINDOW] = Dw
    return D


def ev_peak_kw(cube, top_idx, charger_kw):
    """EV charging observed at system peak hours: rise above a +/-6 h rolling floor, only when > 3 kW."""
    flat = cube.reshape(len(cube), -1)
    sp = np.pad(flat, ((0, 0), (6, 6)), mode="edge")
    floor = swv(sp, 13, axis=1).min(-1)
    r = (flat - floor)[:, top_idx]
    r = np.where(r > 3.0, np.minimum(r, charger_kw[:, None]), 0)
    return r.mean(1)


def analyse(custs, cube, temp, F, C, S, chunk=1000):
    n = len(custs)
    act = (C.inactive == 0).values
    flatsys = cube[act].sum(0).ravel()
    top100 = np.argsort(flatsys)[::-1][:100]
    td_idx, th_idx = top100 // 24, top100 % 24
    E2 = E_NOM * (1 - RESERVE)
    res = {k: np.zeros(n) for k in ["peak_before", "peak_after_2u", "peak_after_1u", "daily_peak_red_2u", "top10day_red_2u",
                                    "coinc_before", "coinc_red_b", "shift_kwh_b", "tou_savings_b", "cycles_b",
                                    "solar_charge_kwh", "ev_add_delta", "ev_add_delta_batt", "hp_add_delta", "hp_add_delta_batt"]}
    # synthetic new loads for electrification enablement test
    ev_add = np.zeros((365, 24)); ev_add[:, 18:21] = 7.2                       # unmanaged L2 arrival 6-9 pm daily
    hp_add = np.clip((55 - temp) * 0.12, 0, 6.0)                                # ducted heat pump kW vs outdoor temp
    for a in range(0, n, chunk):
        L = cube[a:a + chunk].astype(np.float64)
        sl = slice(a, a + chunk)
        # Mode A, 2 units and 1 unit
        netA, DA = mode_a(L, E2, P_MAX)
        net1, _ = mode_a(L, E2 / 2, P_MAX / 2)
        res["peak_before"][sl] = L.max((1, 2))
        res["peak_after_2u"][sl] = netA.max((1, 2))
        res["peak_after_1u"][sl] = net1.max((1, 2))
        dp = L.max(2) - netA.max(2)
        res["daily_peak_red_2u"][sl] = dp.mean(1)
        top10 = np.argsort(-L.max(2), 1)[:, :10]
        res["top10day_red_2u"][sl] = np.take_along_axis(dp, top10, 1).mean(1)
        # Mode B
        DB = mode_b(L, E2, P_MAX)
        res["coinc_before"][sl] = L[:, td_idx, th_idx].mean(1)
        res["coinc_red_b"][sl] = DB[:, td_idx, th_idx].mean(1)
        dis = DB.sum(2)
        res["shift_kwh_b"][sl] = dis.sum(1)
        res["tou_savings_b"][sl] = (dis[:, TOU_PEAK_MONTHS] * (PRICE_PEAK - PRICE_OFF / RTE)).sum(1)
        res["cycles_b"][sl] = dis.sum(1) / E2
        # solar charging: energy that can come from midday surplus (zero-net hours, assumed 3 kW export each)
        zh = (L[:, :, 9:16] < 0.02).sum(2) * 3.0
        res["solar_charge_kwh"][sl] = np.minimum(zh, dis / RTE).sum(1)
        # electrification enablement
        for key, add in [("ev", ev_add), ("hp", hp_add)]:
            L2 = L + add[None]
            netE, _ = mode_a(L2, E2, P_MAX)
            res[f"{key}_add_delta"][sl] = L2.max((1, 2)) - L.max((1, 2))
            res[f"{key}_add_delta_batt"][sl] = netE.max((1, 2)) - L.max((1, 2))
    R = pd.DataFrame(res, index=pd.Index(custs, name="cust"))
    R["peak_red_2u"] = R.peak_before - R.peak_after_2u
    R["peak_red_1u"] = R.peak_before - R.peak_after_1u
    R["capacity_value"] = R.coinc_red_b * CAPACITY_VALUE
    R["annual_value"] = R.capacity_value + R.tou_savings_b

    # demand flexibility (no battery) at system peak hours
    charger = np.where(C.ev == 1, np.maximum(C.ev_charger_kw, 3.3), 0).astype(float)
    R["flex_ev_kw"] = np.where(C.ev == 1, ev_peak_kw(cube, top100, np.maximum(charger, 3.3)), 0)
    R["flex_ac_kw"] = 0.3 * C.ac_kw_est.values
    pool_overlap = (F.pool_block_start.values + 5 >= 16) & (F.pool_block_start.values <= 20)
    R["flex_pool_kw"] = np.where((C.pool == 1).values & pool_overlap, C.pool_kw_est.values, 0)
    R["flex_wh_kw"] = 0.4 * C.water_heater.values
    R["flex_total_kw"] = R[["flex_ev_kw", "flex_ac_kw", "flex_pool_kw", "flex_wh_kw"]].sum(axis=1).clip(upper=R.coinc_before)

    # electrification enablement against the 3 kVA rule
    R["ev_needs_eval"] = (R.ev_add_delta > SERVICE_LIMIT_KVA).astype(int)
    R["ev_enabled_by_batt"] = ((R.ev_add_delta > SERVICE_LIMIT_KVA) & (R.ev_add_delta_batt <= SERVICE_LIMIT_KVA)).astype(int)
    R["hp_needs_eval"] = (R.hp_add_delta > SERVICE_LIMIT_KVA).astype(int)
    R["hp_enabled_by_batt"] = ((R.hp_add_delta > SERVICE_LIMIT_KVA) & (R.hp_add_delta_batt <= SERVICE_LIMIT_KVA)).astype(int)

    # sizing recommendation
    marg = R.peak_red_2u - R.peak_red_1u
    R["recommendation"] = np.select(
        [~act, R.peak_red_1u < 1.0, marg < 1.0],
        ["exclude", "demand flex only", "1 unit (10.08 kWh)"], "2 units (20.16 kWh)")
    R["flex_reduction_kw"] = R.flex_total_kw

    # Battery Priority Index (0-100): weighted percentile ranks among active, eligible customers
    # >38.4 kW hourly exceeds a 200 A / 240 V service at 80 % continuous: larger service or non-residential -> evaluate separately
    R["large_service"] = (R.peak_before > 38.4).astype(int)
    elig = act & (C.seasonal_home.values == 0) & (R.large_service.values == 0)
    pr = lambda v: pd.Series(v, index=R.index)[elig].rank(pct=True).reindex(R.index).fillna(0)
    electrification = (C.ev + C.heat_pump + C.eheat + 0.5 * S["tag_Likely tech adopter"] + 0.5 * S["tag_Emerging electrification candidate"]).clip(upper=2) / 2
    persist = (cube.max(2) > 6.0).sum(1)
    R["persistent_peak_days"] = persist
    R["bpi"] = 100 * (0.30 * pr(R.coinc_red_b) + 0.25 * pr(R.peak_red_2u) + 0.15 * pr(R.shift_kwh_b)
                      + 0.15 * electrification.values * elig + 0.10 * pr(persist) + 0.05 * (C.pv.values * elig))
    R.loc[~elig, "bpi"] = 0
    q95, q85 = R.loc[elig, "bpi"].quantile([0.95, 0.85])
    R["tier"] = np.select([~elig, R.bpi >= q95, R.bpi >= q85, R.flex_total_kw >= 0.5],
                          ["not eligible", "Tier 1: deploy BESS", "Tier 2: offer BESS", "Tier 3: demand-flex program"], "Tier 4: monitor")
    R.attrs["top100"] = top100
    return R


if __name__ == "__main__":
    import argparse, json
    ap = argparse.ArgumentParser()
    ap.add_argument("--cube", default="data/cube.npz")
    ap.add_argument("--features", default="outputs/features.pkl")
    ap.add_argument("--classification", default="outputs/classification.csv")
    ap.add_argument("--segments", default="outputs/segments.csv")
    ap.add_argument("--out", default="outputs/bess.csv")
    a = ap.parse_args()
    z = np.load(a.cube)
    F = pd.read_pickle(a.features); C = pd.read_csv(a.classification, index_col=0).fillna({"ev_level": "", "ac_type": ""})
    S = pd.read_csv(a.segments, index_col=0)
    R = analyse(z["custs"], z["cube"], z["temp"], F, C, S)
    R.to_csv(a.out)
    print(R.tier.value_counts()); print(R.recommendation.value_counts())
    print(R.groupby("tier")[["peak_before", "peak_red_2u", "coinc_before", "coinc_red_b", "shift_kwh_b", "tou_savings_b", "annual_value", "flex_total_kw"]].mean().round(2))
