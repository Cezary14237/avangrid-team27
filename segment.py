"""Step 4: customer segmentation.

(a) Load-shape archetypes: k-means on each customer's normalised seasonal average day
    (winter / summer / shoulder x 24 h, divided by the customer's annual mean) -> 72-dim vector.
    k selected by silhouette score on a sample (k = 4..9).
(b) Business segments (rule-based, from the classification + system-peak coincidence), one primary
    segment per customer chosen by utility priority, plus overlapping tags.
"""
import numpy as np, pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

DATES = pd.date_range("2025-09-01", periods=365)
MONTH = DATES.month.values
SEASONS = {"winter": np.isin(MONTH, [12, 1, 2]), "summer": np.isin(MONTH, [6, 7, 8]), "shoulder": np.isin(MONTH, [3, 4, 5, 9, 10, 11])}


def shape_vectors(cube):
    mean = cube.mean((1, 2), keepdims=False)[:, None] + 1e-6
    return np.hstack([cube[:, m].mean(1) / mean for m in SEASONS.values()])


def name_cluster(c):
    w, s, sh = c[:24], c[24:48], c[48:]
    allp = np.r_[w, s, sh]
    mid = np.r_[w[10:15], s[10:15], sh[10:15]].mean() / (allp.mean() + 1e-6)
    ws = w.mean() / (s.mean() + 1e-6)
    if mid < 0.55:
        return "Solar midday dip"
    if ws > 2.0:
        return "Primary electric heat"
    if ws > 1.3:
        return "Supplemental electric heat"
    if ws < 1 / 2.2:
        return "Cooling-dominant"
    if s.argmax() >= 20 or s[:3].mean() > 1.2:
        return "Late-evening / overnight summer"
    if ws < 0.8:
        return "Summer evening peak (AC)"
    return "Balanced, daytime-occupied"


def archetypes(cube, active, k_range=range(4, 10), seed=0):
    V = shape_vectors(cube)
    Va = V[active]
    rng = np.random.default_rng(seed)
    samp = rng.choice(len(Va), min(3000, len(Va)), replace=False)
    scores = {}
    for k in k_range:
        km = KMeans(k, n_init=5, random_state=seed).fit(Va[samp])
        scores[k] = silhouette_score(Va[samp], km.labels_)
    k = max(scores, key=scores.get)
    if k < 6:   # prefer a more granular, still well-separated solution for program design
        k = 6
    km = KMeans(k, n_init=10, random_state=seed).fit(Va)
    lab = np.full(len(V), -1)
    lab[active] = km.labels_
    names = {i: name_cluster(c) for i, c in enumerate(km.cluster_centers_)}
    # disambiguate duplicate names
    seen = {}
    for i in sorted(names, key=lambda i: -np.sum(km.labels_ == i)):
        n = names[i]; seen[n] = seen.get(n, 0) + 1
        if seen[n] > 1:
            names[i] = f"{n} #{seen[n]}"
    return lab, names, km.cluster_centers_, scores


def business_segments(F, C, coinc_kw):
    S = pd.DataFrame(index=F.index)
    act = C.inactive == 0
    elec_count = C.ev + C.heat_pump + C.eheat + C.pv
    S["coincident_kw"] = coinc_kw
    p90 = np.percentile(coinc_kw[act], 90)
    tags = {
        "High electrification": act & ((elec_count >= 2) | ((C.ev == 1) & (F.annual_kwh > 12000)) | ((C.eheat == 1) & (F.annual_kwh > 15000))),
        "Peak demand contributor": act & (coinc_kw >= p90),
        "Seasonal / part-year occupancy": C.seasonal_home == 1,
        "Flexible load": act & ((C.ev_level == "L2") | (C.pool == 1) | (C.ac_type == "central") | (C.water_heater == 1)),
        "Solar prosumer": act & (C.pv == 1),
        # lookalikes: no EV yet, but usage pattern similar to EV owners (PU score in the 50th-95th pct of non-EVs)
        "Likely tech adopter": act & (C.ev == 0) & (C.p_ev_final >= C.loc[act & (C.ev == 0), "p_ev_final"].quantile(0.9)) & (F.annual_kwh > 8000),
        "Emerging electrification candidate": act & (C.eheat == 0) & (C.heat_pump == 0) & (C.ev == 0) & (C.eheat_supplemental == 1),
        "Inactive / low use": C.inactive == 1,
    }
    for k, v in tags.items():
        S["tag_" + k] = v.astype(int)
    order = ["Inactive / low use", "Seasonal / part-year occupancy", "High electrification", "Peak demand contributor",
             "Solar prosumer", "Flexible load", "Likely tech adopter", "Emerging electrification candidate"]
    prim = pd.Series("Baseline residential", index=F.index)
    for k in reversed(order):
        prim[tags[k]] = k
    S["primary_segment"] = prim
    return S


if __name__ == "__main__":
    import argparse, json
    ap = argparse.ArgumentParser()
    ap.add_argument("--cube", default="data/cube.npz")
    ap.add_argument("--features", default="outputs/features.pkl")
    ap.add_argument("--classification", default="outputs/classification.csv")
    ap.add_argument("--out", default="outputs/segments.csv")
    a = ap.parse_args()
    z = np.load(a.cube); cube = z["cube"]
    F = pd.read_pickle(a.features); C = pd.read_csv(a.classification, index_col=0)
    act = (C.inactive == 0).values
    sysl = cube[act].sum(0).ravel()
    top100 = np.argsort(sysl)[::-1][:100]
    coinc = cube.reshape(len(cube), -1)[:, top100].mean(1)
    lab, names, centers, sil = archetypes(cube, act)
    S = business_segments(F, C, coinc)
    S["archetype_id"] = lab
    S["archetype"] = [names.get(i, "Inactive") for i in lab]
    S.to_csv(a.out)
    np.save(a.out.replace(".csv", "_centers.npy"), centers)
    json.dump({"silhouette": {int(k): float(v) for k, v in sil.items()}, "names": {int(k): v for k, v in names.items()},
               "system_top100_hours": [int(x) for x in top100]}, open(a.out.replace(".csv", "_meta.json"), "w"), indent=1)
    print(S.archetype.value_counts()); print(S.primary_segment.value_counts()); print(sil)
