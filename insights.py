"""Step 6: planning insights + one JSON with every headline number used in the deck."""
import json, numpy as np, pandas as pd

DATES = pd.date_range("2025-09-01", periods=365)
MONTH = DATES.month.values


def main(cube_path, out_dir, total_customers=35725):
    z = np.load(cube_path); cube, temp, custs = z["cube"], z["temp"], z["custs"]
    F = pd.read_pickle(f"{out_dir}/features.pkl")
    C = pd.read_csv(f"{out_dir}/classification.csv", index_col=0)
    S = pd.read_csv(f"{out_dir}/segments.csv", index_col=0)
    R = pd.read_csv(f"{out_dir}/bess.csv", index_col=0)
    meta = json.load(open(f"{out_dir}/classification_meta.json"))
    act = (C.inactive == 0).values
    na = int(act.sum())
    sysl = cube[act].sum(0)
    flat = sysl.ravel()
    pk = int(flat.argmax())
    winter = np.isin(MONTH, [12, 1, 2])
    wflat = sysl[winter].ravel(); wpk = int(wflat.argmax())
    out = {"customers_in_run": int(len(custs)), "active": na, "scale_factor": total_customers / len(custs)}
    out["system_peak_kw_per_cust"] = float(flat.max() / na)
    out["system_peak_when"] = f"{DATES[pk // 24].date()} HE{pk % 24 + 1}"
    out["system_peak_temp_f"] = float(temp.ravel()[pk])
    out["winter_peak_kw_per_cust"] = float(wflat.max() / na)
    wd = np.where(winter)[0][wpk // 24]
    out["winter_peak_when"] = f"{DATES[wd].date()} HE{wpk % 24 + 1}"
    out["winter_peak_temp_f"] = float(temp[wd, wpk % 24])

    # peak flip: add a ducted heat pump to a growing share of homes without electric heat
    hp_add = np.clip((55 - temp) * 0.12, 0, 6.0)
    cand = np.where(act & (C.eheat.values == 0) & (C.heat_pump.values == 0))[0]
    rng = np.random.default_rng(0); rng.shuffle(cand)
    summer_pk = sysl[~winter].max()
    flip = None
    curve = []
    for share in np.arange(0, 0.41, 0.02):
        k = int(share * na)
        new = sysl + hp_add * k
        curve.append((float(share), float(new[winter].max() / na), float(summer_pk / na)))
        if flip is None and new[winter].max() > max(summer_pk, new[~winter].max()):
            flip = float(share)
    out["hp_adoption_share_to_flip_peak"] = flip
    out["peak_flip_curve"] = curve

    # inventory
    inv = {}
    for k in ["ev", "heat_pump", "eheat", "eheat_supplemental", "resistance_heat", "ac", "pool", "water_heater", "hot_tub",
              "pv", "pv_unregistered", "pv_new_install", "pv_battery", "seasonal_home", "always_on_high", "inactive"]:
        inv[k] = int(C[k].sum())
    inv["ev_L2"] = int(((C.ev == 1) & (C.ev_level == "L2")).sum())
    inv["ev_L1"] = int(((C.ev == 1) & (C.ev_level == "L1")).sum())
    inv["ac_central"] = int((C.ac_type == "central").sum())
    out["inventory"] = inv
    out["inventory_scaled_35725"] = {k: round(v * out["scale_factor"]) for k, v in inv.items()}

    # validation vs labels
    val = {}
    for t, col, p in [("EV", "ev", "p_ev_final"), ("HP", "heat_pump", "p_hp_final"), ("PV", "pv", "p_pv")]:
        y = C[f"label_{t}"] == 1
        r = C.loc[act, p].rank(ascending=False); ya = y[act]
        n = int(round(ya.sum() / 0.25)) if t != "PV" else int(ya.sum())
        rec = float((r[ya] <= n).mean())
        k10 = int(0.10 * na)
        rec10 = float((r[ya] <= k10).mean())
        val[t] = {"labeled": int(y.sum()), "top_n": n, "oof_recall_at_top_n": rec,
                  "lift_vs_random": rec / (n / na), "recall_top10pct": rec10, "lift_top10pct": rec10 / 0.10}
    val["PV"]["rule_recall"] = float(((C.p_pv >= 0.5) & (C.label_PV == 1)).sum() / max(1, C.label_PV.sum()))
    val["PV"]["rule_precision_vs_list"] = float(((C.p_pv >= 0.5) & (C.label_PV == 1)).sum() / max(1, (C.p_pv >= 0.5).sum()))
    out["validation"] = val
    out["pu_meta"] = meta

    # segments
    out["archetypes"] = S.loc[S.archetype != "Inactive", "archetype"].value_counts().to_dict()
    seg = S.join(F[["annual_kwh"]]).join(R[["coinc_before", "peak_before", "flex_total_kw", "bpi"]])
    g = seg.groupby("primary_segment").agg(n=("annual_kwh", "size"), kwh=("annual_kwh", "median"),
                                          coinc=("coinc_before", "mean"), peak=("peak_before", "median"),
                                          flex=("flex_total_kw", "mean"))
    g["share_of_coincident_peak"] = seg.groupby("primary_segment").coinc_before.sum() / seg.coinc_before[act].sum()
    out["segments"] = g.round(3).reset_index().to_dict("records")

    # battery
    t = R.groupby("tier").agg(n=("bpi", "size"), peak=("peak_before", "mean"), red=("peak_red_2u", "mean"),
                              coinc=("coinc_before", "mean"), coinc_red=("coinc_red_b", "mean"), shift=("shift_kwh_b", "mean"),
                              tou=("tou_savings_b", "mean"), cap=("capacity_value", "mean"), val=("annual_value", "mean"),
                              flex=("flex_total_kw", "mean"))
    out["tiers"] = t.round(2).reset_index().to_dict("records")
    t1 = R.tier.str.startswith("Tier 1")
    out["tier1_total_coinc_relief_kw"] = float(R.loc[t1, "coinc_red_b"].sum())
    out["tier1_share_of_system_peak"] = float(R.loc[t1, "coinc_red_b"].sum() / flat.max())
    out["tier12_total_coinc_relief_kw"] = float(R.loc[R.tier.str.startswith(("Tier 1", "Tier 2")), "coinc_red_b"].sum())
    out["flex_total_kw"] = float(R.loc[act, "flex_total_kw"].sum())
    out["flex_breakdown_kw"] = {k: float(R.loc[act, k].sum()) for k in ["flex_ev_kw", "flex_ac_kw", "flex_pool_kw", "flex_wh_kw"]}
    out["flex_share_of_system_peak"] = out["flex_total_kw"] / float(flat.max())
    out["value_ratio_tier1_vs_avg"] = float(R.loc[t1, "annual_value"].mean() / R.loc[act, "annual_value"].mean())
    out["value_ratio_tier1_vs_tier4"] = float(R.loc[t1, "annual_value"].mean() / R.loc[R.tier.str.startswith("Tier 4"), "annual_value"].mean())
    out["recommendation_counts"] = R.recommendation.value_counts().to_dict()
    out["ev_needs_eval_share"] = float(R.loc[act, "ev_needs_eval"].mean())
    out["ev_enabled_share"] = float(R.loc[act, "ev_enabled_by_batt"].mean())
    out["hp_needs_eval_share"] = float(R.loc[act, "hp_needs_eval"].mean())
    out["hp_enabled_share"] = float(R.loc[act, "hp_enabled_by_batt"].mean())
    out["median_ev_delta_kw"] = float(R.loc[act, "ev_add_delta"].median())
    out["median_ev_delta_batt_kw"] = float(R.loc[act, "ev_add_delta_batt"].median())
    json.dump(out, open(f"{out_dir}/summary.json", "w"), indent=1, default=float)

    # customer-level master table (the "tool" output)
    keep_c = ["inactive", "ev", "ev_level", "ev_confidence", "p_ev_final", "heat_pump", "hp_confidence", "p_hp_final", "eheat",
              "eheat_supplemental", "p_eheat", "ac", "ac_type", "p_ac", "ac_kw_est", "pool", "p_pool", "water_heater", "p_ewh",
              "hot_tub", "p_hottub", "pv", "pv_unregistered", "pv_new_install", "pv_battery", "seasonal_home", "always_on_high",
              "label_EV", "label_HP", "label_PV"]
    keep_r = ["peak_before", "coinc_before", "peak_red_1u", "peak_red_2u", "coinc_red_b", "shift_kwh_b", "tou_savings_b",
              "capacity_value", "annual_value", "flex_total_kw", "ev_enabled_by_batt", "hp_enabled_by_batt", "recommendation", "bpi", "tier"]
    M = F[["annual_kwh"]].join(C[keep_c]).join(S[["primary_segment", "archetype"]]).join(R[keep_r])
    M.sort_values("bpi", ascending=False).to_csv(f"{out_dir}/customer_master.csv")
    return out


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(); ap.add_argument("--cube", default="data/cube.npz"); ap.add_argument("--out", default="outputs")
    a = ap.parse_args()
    o = main(a.cube, a.out)
    print(json.dumps({k: v for k, v in o.items() if k not in ("peak_flip_curve", "segments", "tiers")}, indent=1, default=float))
