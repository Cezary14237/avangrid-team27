"""Step 3: customer technology classification.

Two families of detectors, both transparent:

A. Positive-Unlabeled (PU) machine learning for EV and heat pump (Elkan & Noto, 2008)
   Avangrid's lists are a *random 25 % sample* of likely EV / HP homes; every other customer is
   "unlabeled" (a mix of negatives and the other 75 % of positives).
     g(x) = P(labeled | x)       LightGBM, out-of-fold (5 folds x 3 repeats)
     c    = E[g(x) | labeled]    label frequency, estimated on held-out positives
     P(tech | x) = min(1, g(x) / c)
   Sanity check: sum_x P(tech|x) should be close to (#labeled / 0.25).

B. Physics rules for technologies without labels, each producing a 0-1 confidence
   score = logistic((feature - threshold) / scale), combined with AND/OR logic.
"""
import numpy as np, pandas as pd, warnings
import lightgbm as lgb
from sklearn.model_selection import StratifiedKFold

warnings.filterwarnings("ignore")
LABEL_FRACTION = 0.25  # stated by Avangrid: samples are ~25 % of each population


def sig(x, thr, scale):
    return 1 / (1 + np.exp(-(x - thr) / scale))


def prior_shift(p, n_exp, iters=60):
    """Shift probabilities in logit space by a constant so that sum(p) == n_exp (known class prior)."""
    lo, hi = -20.0, 20.0
    lg = np.log(np.clip(p, 1e-6, 1 - 1e-6) / (1 - np.clip(p, 1e-6, 1 - 1e-6)))
    for _ in range(iters):
        mid = (lo + hi) / 2
        if (1 / (1 + np.exp(-(lg + mid)))).sum() > n_exp:
            hi = mid
        else:
            lo = mid
    return 1 / (1 + np.exp(-(lg + (lo + hi) / 2)))


def prior_matched_flag(score, labeled, active, n_exp):
    """Known positives + the top-ranked unlabeled customers until the known population size is reached."""
    score = pd.Series(np.where(active, score, -1), index=score.index)
    n_extra = max(0, int(round(n_exp)) - int(labeled.sum()))
    top = score[labeled == 0].nlargest(n_extra).index
    flag = labeled.copy().astype(int)
    flag.loc[top] = 1
    return flag


def model_matrix(F):
    X = F.copy()
    for c in X.columns:
        if (X[c] >= 0).all() and X[c].max() > 5:
            X[c] = np.log1p(X[c])
    return X


def pu_probability(X, y, seeds=3, folds=5):
    """Out-of-fold PU scores. Returns P(tech|x), g(x), c_hat, feature importances."""
    g = np.zeros(len(y))
    imp = np.zeros(X.shape[1])
    params = dict(n_estimators=250, learning_rate=0.03, num_leaves=6, min_child_samples=8, subsample=0.8,
                  subsample_freq=1, colsample_bytree=0.5, reg_lambda=5, verbose=-1)
    for s in range(seeds):
        for tr, te in StratifiedKFold(folds, shuffle=True, random_state=s).split(X, y):
            m = lgb.LGBMClassifier(random_state=s, **params)
            m.fit(X.iloc[tr], y[tr])
            g[te] += m.predict_proba(X.iloc[te])[:, 1] / seeds
            imp += m.booster_.feature_importance("gain")
    c_hat = g[y == 1].mean()
    p = np.clip(g / c_hat, 0, 1)
    return p, g, c_hat, pd.Series(imp / imp.sum(), index=X.columns).sort_values(ascending=False)


def classify(F, labels):
    out = pd.DataFrame(index=F.index)
    lab = {t: F.index.isin(labels.loc[labels.label == t, "cust"]) for t in ["EV", "HP", "PV"]}
    out["label_EV"], out["label_HP"], out["label_PV"] = lab["EV"].astype(int), lab["HP"].astype(int), lab["PV"].astype(int)

    # ---------- data quality: inactive / vacant accounts are excluded from programs
    out["inactive"] = ((F.annual_kwh < 600) | ((F.zero_share > 0.5) & (F.solar_day_share < 0.1))).astype(int)

    # ---------- solar PV (all PV customers are known -> fully supervised check)
    out["p_pv"] = np.maximum(sig(F.solar_day_share_summer, 0.12, 0.03), sig(0.45 - F.summer_midday_dip, 0, 0.05) * (F.zero_share > 0.02))
    out["pv"] = (((out.p_pv >= 0.5) & (out.inactive == 0)) | (out.label_PV == 1)).astype(int)
    out["pv_unregistered"] = ((out.pv == 1) & (out.label_PV == 0) & (out.inactive == 0)).astype(int)
    out["pv_new_install"] = ((out.pv == 1) & (F.solar_sep_oct < 0.05) & (F.solar_jun_aug > 0.3)).astype(int)
    out["p_pv_battery"] = (sig(F.battery_like_days, 20, 4) * (out.inactive == 0)).round(3)  # PV may be unregistered
    out["pv_battery"] = (out.p_pv_battery >= 0.5).astype(int)

    # ---------- EV and heat pump: PU learning
    X = model_matrix(F)
    act = out.inactive.values == 0
    imps = {}
    for t, col in [("EV", "p_ev"), ("HP", "p_hp")]:
        y = lab[t].astype(int)
        p = np.zeros(len(F)); g = np.zeros(len(F))
        p[act], g[act], c_hat, imps[t] = pu_probability(X[act], y[act])
        # prior correction: shift log-odds so the expected count equals the known population size
        n_exp = y[act].sum() / LABEL_FRACTION
        p[act] = prior_shift(p[act], n_exp)
        out[col] = p.round(3)
        out[f"g_{t.lower()}"] = g.round(4)
        out.attrs[f"c_hat_{t}"] = float(c_hat)
        out.attrs[f"expected_population_{t}"] = float(n_exp)
    # physics evidence for EV level
    l2_evidence = sig(np.log1p(F.up_steps_5kw_warm), np.log1p(10), 0.4) * sig(np.log1p(F.l2_events), np.log1p(20), 0.4)
    l1_evidence = sig(F.l1_events, 60, 15) * sig(F.l1_night, 0.5, 0.08) * sig(F.l1_warm, 0.3, 0.08)
    out["ev_l2_evidence"] = l2_evidence.round(3)
    out["ev_l1_evidence"] = l1_evidence.round(3)
    # final EV score blends model and physics (the model alone over-fits 50-200 noisy labels)
    blend = 0.6 * out.p_ev + 0.4 * np.maximum(l2_evidence, l1_evidence)
    out["p_ev_final"] = np.where(act, prior_shift(blend.values, out.attrs["expected_population_EV"]), 0).round(3)
    out["ev"] = prior_matched_flag(out.p_ev_final, out.label_EV, act, out.attrs["expected_population_EV"])
    out["ev_confidence"] = np.where(out.label_EV == 1, "labeled", np.where(out.p_ev_final >= 0.5, "high", np.where(out.ev == 1, "medium", "")))
    out["ev_level"] = np.where(out.ev == 0, "", np.where(l2_evidence >= l1_evidence, "L2", "L1"))
    out["ev_charger_kw"] = np.where(out.ev_level == "L2", F.l2_level.clip(3.3, 11.5), np.where(out.ev_level == "L1", F.l1_level.clip(1.0, 1.9), 0))

    # ---------- space cooling
    out["p_ac"] = (sig(F.ac_kw_hot, 0.5, 0.15) * sig(F.cp_cool_slope, 0.3, 0.1)).round(3)
    out["ac"] = (out.p_ac >= 0.5).astype(int) * (1 - out.inactive)
    out["ac_type"] = np.where(out.ac == 0, "", np.where(F.ac_kw_hot >= 1.8, "central", "room/mini-split"))
    out["ac_kw_est"] = np.where(out.ac == 1, F.ac_kw_hot.clip(0), 0).round(2)

    # ---------- electric space heating
    # primary electric heat: >= ~4,000 kWh/yr of temperature-driven heating load; supplemental: 1,500-4,000
    out["p_eheat"] = (sig(F.heat_kwh_yr, 4000, 500) * sig(F.heat_share, 0.25, 0.05)).round(3)
    out["eheat"] = ((out.p_eheat >= 0.5) & (out.inactive == 0)).astype(int)
    out["eheat_supplemental"] = ((out.eheat == 0) & (F.heat_kwh_yr >= 1500) & (out.inactive == 0)).astype(int)
    # heat pump vs resistance within electric-heat homes: PU model + physics (heat pumps also cool,
    # run flatter, and are used at shoulder temperatures)
    # composite percentile score: hourly winter temperature sensitivity, daily heating slope,
    # shoulder-season heating (cheap heat-pump hours) and cooling (heat pumps also cool)
    R = lambda v: v.rank(pct=True)
    hp_phys = (R(F.heat_hourly_slope) + R(F.cp_heat_slope) + R(F.shoulder_heat_slope) + R(F.cp_cool_slope)) / 4
    out["hp_physics"] = hp_phys.round(3)
    heat_gate = sig(F.heat_kwh_yr, 1500, 300)
    blend = (0.3 * out.p_hp + 0.7 * hp_phys ** 3) * heat_gate
    out["p_hp_final"] = np.where(act, prior_shift(blend.values, out.attrs["expected_population_HP"]), 0).round(3)
    out["heat_pump"] = prior_matched_flag(out.p_hp_final, out.label_HP, act, out.attrs["expected_population_HP"])
    out["hp_confidence"] = np.where(out.label_HP == 1, "labeled", np.where(out.p_hp_final >= 0.5, "high", np.where(out.heat_pump == 1, "medium", "")))
    out["resistance_heat"] = ((out.eheat == 1) & (out.heat_pump == 0)).astype(int)
    out["heat_kw_est"] = np.where(out.eheat == 1, F.winter_peak_kw - F.base_kw, 0).round(2)

    # ---------- electric water heater (year-round morning + evening bumps of 1-4.5 kW)
    out["p_ewh"] = (sig(F.wh_morning_bump, 0.9, 0.2) * sig(F.wh_evening_bump, 0.9, 0.2)).round(3)
    out["water_heater"] = ((out.p_ewh >= 0.5) & (out.inactive == 0)).astype(int)

    # ---------- pool pump: fixed-hour block that appears in summer regardless of temperature
    out["p_pool"] = (sig(F.pool_uplift_6h, 1.0, 0.15) * sig(F.pool_summer_step, 1.0, 0.15) * sig(F.pool_contrast, 0.6, 0.1)
                     * sig(0.5 - F.pool_temp_corr, 0, 0.08) * sig(0.5 - F.pool_block_cv, 0, 0.08)).round(3)
    out["pool"] = ((out.p_pool >= 0.5) & (out.inactive == 0)).astype(int)
    out["pool_kw_est"] = np.where(out.pool == 1, F.pool_uplift_6h, 0).round(2)

    # ---------- hot tub (heuristic, low confidence on hourly data): year-round elevated night base with
    # 3-5 kW blocks that persist in warm months, without space-heating dominance
    out["p_hottub"] = (sig(F.base_kw, 0.8, 0.15) * sig(F.mid_events, 40, 10) * sig(F.mid_warm, 0.4, 0.1) * (1 - out.p_eheat) * (1 - out.p_pool)).round(3)
    out["hot_tub"] = ((out.p_hottub >= 0.5) & (out.inactive == 0)).astype(int)

    # ---------- other signatures discovered
    out["always_on_high"] = ((F.load_factor > 0.55) & (F.mean_kw > 1.5) & (out.inactive == 0)).astype(int)  # crypto / servers / well & sump pumps
    out["seasonal_home"] = ((F.longest_vacancy >= 30) & (out.inactive == 0)).astype(int)
    out.attrs["importances"] = imps
    return out


if __name__ == "__main__":
    import argparse, json
    ap = argparse.ArgumentParser()
    ap.add_argument("--features", default="outputs/features.pkl")
    ap.add_argument("--labels", required=True)
    ap.add_argument("--out", default="outputs/classification.csv")
    a = ap.parse_args()
    F = pd.read_pickle(a.features)
    C = classify(F, pd.read_csv(a.labels))
    C.to_csv(a.out)
    meta = {k: v for k, v in C.attrs.items() if k != "importances"}
    for t, s in C.attrs["importances"].items():
        s.head(15).to_csv(a.out.replace(".csv", f"_importance_{t}.csv"))
    json.dump(meta, open(a.out.replace(".csv", "_meta.json"), "w"), indent=1)
    print(meta)
    print(C[[c for c in C.columns if C[c].dtype != object and set(C[c].unique()) <= {0, 1}]].sum())
