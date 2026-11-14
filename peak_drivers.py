"""What drives the summer and the winter peak, and the solar + battery offer.

* load of each home at the 20 highest system hours in Jun to Aug and in Dec to Feb
* share of each peak by technology group
* kW each technology adds at each peak (OLS on technology flags, active homes)
* solar homes: battery value and how much solar-hour energy could charge a battery
"""
import argparse, json
import numpy as np
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("--cube", required=True)
ap.add_argument("--out", default="outputs")
a = ap.parse_args()

z = np.load(a.cube)
custs, cube = z["custs"], z["cube"]
M = pd.read_csv(f"{a.out}/customer_master.csv").set_index("cust").loc[custs]
act = (M.inactive == 0).values
dates = pd.date_range("2025-09-01", periods=cube.shape[1])
tot = cube[act].sum(0)


def top_hours(months, k=20):
    t = np.where(np.isin(dates.month, months)[:, None], tot, -np.inf).ravel()
    idx = np.argsort(t)[::-1][:k]
    return idx // 24, idx % 24


out = {}
groups = {
    "central_ac": (M.ac_type == "central").values,
    "room_ac": (M.ac_type == "room/mini-split").values,
    "eheat_primary": (M.eheat == 1).values,
    "eheat_supplemental": (M.eheat_supplemental == 1).values,
    "ev": (M.ev == 1).values,
    "solar": (M.pv == 1).values,
}
loads = {}
for season, months in [("summer", [6, 7, 8]), ("winter", [12, 1, 2])]:
    d, h = top_hours(months)
    load = cube[:, d, h].mean(1)
    loads[season] = load
    L = load[act].sum()
    out[f"{season}_groups"] = {g: {"homes": int((m & act).sum()), "share_homes": float((m & act).sum() / act.sum()),
                                   "share_peak": float(load[m & act].sum() / L), "kw_per_home": float(load[m & act].mean())}
                               for g, m in groups.items()}

# kW added by each technology (OLS, intercept = home with none of them)
X = np.column_stack([np.ones(act.sum())] + [groups[g][act].astype(float) for g in groups])
for season in ["summer", "winter"]:
    beta, *_ = np.linalg.lstsq(X, loads[season][act], rcond=None)
    out[f"{season}_kw_added"] = {"base": float(beta[0]), **{g: float(b) for g, b in zip(groups, beta[1:])}}

# solar + battery offer
B = pd.read_csv(f"{a.out}/bess.csv", index_col=0).loc[custs]
sol = groups["solar"] & act
mid = np.zeros(cube.shape[1], bool)
summer = np.isin(dates.month, [5, 6, 7, 8, 9])
# energy a home buys 11 am to 3 pm on summer days shows what is left after solar. Zero = surplus likely exported.
zero_mid = (cube[:, :, 10:15].sum(2) < 0.05)
out["solar_offer"] = {
    "homes": int(sol.sum()),
    "registered": int(((M.label_PV == 1).values & act).sum()),
    "unregistered": int(((M.pv_unregistered == 1).values & act).sum()),
    "coinc_red_kw": float(B.loc[sol, "coinc_red_b"].mean()),
    "annual_value": float(B.loc[sol, "annual_value"].mean()),
    "summer_days_midday_zero": float(zero_mid[sol][:, summer].mean()),
    "tier_counts": B.loc[sol, "tier"].value_counts().to_dict(),
}

# battery economics per Tier 1 battery (team estimate)
t1 = (B.tier.str.startswith("Tier 1")).values
kw = float(B.loc[t1, "coinc_red_b"].mean()); tou = float(B.loc[t1, "tou_savings_b"].mean())
COST = 26000.0          # 2 x Enphase IQ 10C, about $13,000 each installed (EnergySage)
LIFE = 15
cap_sys, cap_con = 74.0, 119.0
ess = 0.8 * 20.16 / 4 * 50     # ESS: up to 80% of the battery over a 4-hour event, $50 per kW of average performance
out["economics"] = {
    "kw_at_system_peak": kw, "tou_per_year": tou, "ess_per_year": ess,
    "capacity_per_year_system": kw * cap_sys, "capacity_per_year_constrained": kw * cap_con,
    "value_per_year_system": kw * cap_sys + tou, "value_per_year_constrained": kw * cap_con + tou,
    "cost": COST, "life_years": LIFE,
    "lifetime_value_system": LIFE * (kw * cap_sys + tou), "lifetime_value_constrained": LIFE * (kw * cap_con + tou),
}
out["economics"]["gap_system"] = COST - out["economics"]["lifetime_value_system"]
out["economics"]["gap_constrained"] = COST - out["economics"]["lifetime_value_constrained"]

# technology bundles: how much more likely an EV is in a solar home than in the average active home
A = M[act]
out["lift_solar_ev"] = float(A.loc[A.pv == 1, "ev"].mean() / A.ev.mean())
json.dump(out, open(f"{a.out}/peak_drivers.json", "w"), indent=1)
print(json.dumps({k: out[k] for k in ["summer_kw_added", "winter_kw_added", "solar_offer", "economics"]}, indent=1))
for s in ["summer", "winter"]:
    print(s, {g: (round(v["share_homes"], 3), round(v["share_peak"], 3)) for g, v in out[f"{s}_groups"].items()})
