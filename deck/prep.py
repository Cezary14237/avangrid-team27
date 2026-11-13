"""Collect every number the deck needs into deck/deck_data.json (deck is regenerated from data, never typed by hand)."""
import json, pandas as pd, numpy as np
o = json.load(open("outputs/summary.json"))
M = pd.read_csv("outputs/customer_master.csv")
top = M[M.tier.str.startswith("Tier 1")].head(8)
o["top_customers"] = [{"cust": int(r.cust), "kwh": float(r.annual_kwh), "tech": ", ".join([t for t, f in [("EV " + str(r.ev_level), r.ev), ("Elec. heat", r.eheat), ("Heat pump", r.heat_pump), ("PV", r.pv), ("Pool", r["pool"]), ("Central AC", r.ac_type == "central")] if f == 1 or f is True]) or "-",
                        "segment": r.primary_segment, "peak": float(r.peak_before), "red": float(r.peak_red_2u), "coinc": float(r.coinc_red_b),
                        "value": float(r.annual_value), "rec": r.recommendation, "bpi": float(r.bpi)} for _, r in top.iterrows()]
S = pd.DataFrame(o["segments"]).set_index("primary_segment")
o["segment_rows"] = S.reset_index().to_dict("records")
json.dump(o, open("deck/deck_data.json", "w"), indent=1, default=float)
print("ok", len(o["top_customers"]))

# ---- extra series for native charts (Focal deck)
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))
from bess import mode_a, E_NOM, RESERVE, P_MAX
z = np.load(os.environ.get("CUBE", "data/cube.npz"))
custs, cube = z["custs"], z["cube"]
idx = {c: i for i, c in enumerate(custs)}
R = pd.read_csv("outputs/bess.csv", index_col=0)
t1 = R[R.tier.str.startswith("Tier 1")].sort_values("bpi", ascending=False)
c = 32369 if 32369 in t1.index else int(t1.index[3])
L = cube[idx[c]].astype(float); d = int(L.max(1).argmax())
net, _ = mode_a(L[None, d:d + 1], E_NOM * (1 - RESERVE), P_MAX)
o["dispatch"] = {"cust": int(c), "date": str(pd.Timestamp("2025-09-01") + pd.Timedelta(days=d))[:10],
                 "load": [round(float(x), 2) for x in L[d]], "net": [round(float(x), 2) for x in net[0, 0]]}
imp = pd.read_csv("outputs/classification_importance_EV.csv", index_col=0).iloc[:8, 0]
o["ev_importance"] = [{"feature": k, "gain": float(v)} for k, v in imp.items()]
M2 = pd.read_csv("outputs/classification.csv", index_col=0)
F2 = pd.read_pickle("outputs/features.pkl")
o["ev_l2_events_median_labeled"] = float(F2.loc[M2.label_EV == 1, "l2_events"].median())
o["ev_l2_events_median_all"] = float(F2.loc[M2.inactive == 0, "l2_events"].median())
o["system_peak_kw_total"] = float(o["system_peak_kw_per_cust"] * o["active"])
json.dump(o, open("deck/deck_data.json", "w"), indent=1, default=float)
print("extra ok", o["dispatch"]["cust"], o["dispatch"]["date"], o["ev_l2_events_median_labeled"], o["ev_l2_events_median_all"])

# ---- counts used in slide text
SM = json.load(open("outputs/segments_meta.json"))
o["n_archetypes"] = len(SM["names"])
days = pd.Timestamp("2025-09-01") + pd.to_timedelta(np.array(SM["system_top100_hours"]) // 24, unit="D")
o["top100_summer"] = int(np.isin(days.month, [6, 7, 8]).sum())
o["runtime_min"] = int(os.environ.get("RUNTIME_MIN", 15))
json.dump(o, open("deck/deck_data.json", "w"), indent=1, default=float)
print("counts ok", o["n_archetypes"], o["top100_summer"], o["runtime_min"])
