"""Step 7: deck-ready figures (PNG, 200 dpi). Palette: validated categorical + one-hue blue ramp."""
import json, os, numpy as np, pandas as pd, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

BLUE, ORANGE, AQUA, YELLOW, MAGENTA, GREEN, VIOLET, RED = "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"
INK, INK2, GRID, SURF = "#0b0b0b", "#52514e", "#e4e3df", "#ffffff"
SEQ = LinearSegmentedColormap.from_list("seq", ["#f4f8fd", "#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"])
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "axes.edgecolor": GRID, "axes.labelcolor": INK2,
                     "xtick.color": INK2, "ytick.color": INK2, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
                     "axes.spines.top": False, "axes.spines.right": False, "axes.titlesize": 12, "axes.titleweight": "bold",
                     "axes.titlecolor": INK, "legend.frameon": False, "figure.facecolor": SURF, "axes.facecolor": SURF})
DATES = pd.date_range("2025-09-01", periods=365)
MONTH = DATES.month.values


def save(fig, path):
    fig.savefig(path, dpi=200, bbox_inches="tight"); plt.close(fig)


def month_ticks(ax):
    starts = [i for i in range(365) if DATES[i].day == 1]
    ax.set_xticks(starts); ax.set_xticklabels([DATES[i].strftime("%b") for i in starts])


def main(cube_path, out, fig_dir):
    os.makedirs(fig_dir, exist_ok=True)
    z = np.load(cube_path); cube, temp, custs = z["cube"], z["temp"], z["custs"]
    idx = {c: i for i, c in enumerate(custs)}
    F = pd.read_pickle(f"{out}/features.pkl"); C = pd.read_csv(f"{out}/classification.csv", index_col=0).fillna({"ev_level": "", "ac_type": ""})
    S = pd.read_csv(f"{out}/segments.csv", index_col=0); R = pd.read_csv(f"{out}/bess.csv", index_col=0)
    O = json.load(open(f"{out}/summary.json"))
    act = (C.inactive == 0).values

    # 1. appliance fingerprints: day x hour heatmaps
    picks = [("EV Level 2 charging", C[(C.ev_level == "L2") & (C.label_EV == 1)].sort_values("p_ev_final").index[-1]),
             ("Solar PV (net load)", C[(C.label_PV == 1)].join(F.solar_day_share_summer).sort_values("solar_day_share_summer").index[-5]),
             ("Primary electric heat", C[C.eheat == 1].sort_values("p_eheat").index[-3]),
             ("Pool pump (summer timer)", C[C.pool == 1].sort_values("p_pool").index[-1])]
    fig, axes = plt.subplots(1, 4, figsize=(16, 4.2))
    for ax, (title, c) in zip(axes, picks):
        x = cube[idx[c]].T
        im = ax.imshow(x, aspect="auto", cmap=SEQ, vmin=0, vmax=np.percentile(x, 99.5), origin="upper")
        ax.set_title(f"{title}\ncustomer {c}", fontsize=11); ax.grid(False)
        month_ticks(ax); ax.tick_params(axis="x", labelsize=7)
        ax.set_yticks([0, 6, 12, 18, 23]); ax.set_yticklabels(["HE1", "HE7", "HE13", "HE19", "HE24"])
        cb = fig.colorbar(im, ax=ax, fraction=0.04, pad=0.02); cb.set_label("kWh / h", fontsize=8); cb.ax.tick_params(labelsize=7)
    fig.tight_layout(); save(fig, f"{fig_dir}/01_fingerprints.png")

    # 2. technology inventory (share of active customers)
    inv = O["inventory"]; na = O["active"]
    items = [("Air conditioning", inv["ac"]), ("  of which central AC", inv["ac_central"]), ("Supplemental electric heat", inv["eheat_supplemental"]),
             ("Primary electric heat", inv["eheat"]), ("EV charging", inv["ev"]), ("  of which Level 2", inv["ev_L2"]),
             ("Electric water heater", inv["water_heater"]), ("Solar PV", inv["pv"]), ("Pool pump", inv["pool"]),
             ("Heat pump", inv["heat_pump"]), ("Hot tub (low conf.)", inv["hot_tub"]), ("Unregistered solar PV", inv["pv_unregistered"])]
    items = sorted(items, key=lambda t: t[1])
    fig, ax = plt.subplots(figsize=(8, 5.2))
    ax.barh([t[0] for t in items], [100 * t[1] / na for t in items], color=BLUE, height=0.62)
    for i, (k, v) in enumerate(items):
        ax.text(100 * v / na + 0.6, i, f"{v:,}  ({100*v/na:.1f}%)", va="center", fontsize=9, color=INK2)
    ax.set_xlabel("% of active customers"); ax.grid(axis="y", visible=False); ax.set_xlim(0, 85)
    ax.set_title(f"Estimated technology inventory, {na:,} active customers", loc="left")
    save(fig, f"{fig_dir}/02_inventory.png")

    # 3. archetype centroids
    cen = np.load(f"{out}/segments_centers.npy"); names = json.load(open(f"{out}/segments_meta.json"))["names"]
    order = sorted(range(len(cen)), key=lambda i: -(S.archetype_id == i).sum())
    fig, axes = plt.subplots(2, 3, figsize=(14, 7), sharey=True)
    for ax, i in zip(axes.flat, order):
        h = np.arange(1, 25)
        ax.plot(h, cen[i][:24], color=BLUE, lw=2, label="Winter (Dec-Feb)")
        ax.plot(h, cen[i][24:48], color=ORANGE, lw=2, label="Summer (Jun-Aug)")
        ax.plot(h, cen[i][48:], color=AQUA, lw=2, label="Shoulder")
        n = int((S.archetype_id == i).sum())
        ax.set_title(f"{names[str(i)]}\n{n:,} customers ({100*n/na:.0f}%)", fontsize=11, loc="left")
        ax.set_xticks([1, 6, 12, 18, 24]); ax.set_xlabel("Hour ending")
    axes[0, 0].set_ylabel("Load / customer annual mean"); axes[1, 0].set_ylabel("Load / customer annual mean")
    axes[0, 0].legend(fontsize=9, loc="upper left")
    fig.tight_layout(); save(fig, f"{fig_dir}/03_archetypes.png")

    # 4. system peak + heat-pump flip
    sysl = cube[act].sum(0) / act.sum()
    fig, axes = plt.subplots(1, 2, figsize=(15, 4.6), gridspec_kw={"width_ratios": [1.6, 1]})
    ax = axes[0]
    ax.plot(np.arange(365), sysl.max(1), color=BLUE, lw=1.6)
    pk = sysl.max(1).argmax(); wk = np.where(np.isin(MONTH, [12, 1, 2]))[0][sysl[np.isin(MONTH, [12, 1, 2])].max(1).argmax()]
    for d, lab in [(pk, f"Annual peak {sysl.max():.2f} kW/cust\n{DATES[pk]:%b %d}, HE{sysl[pk].argmax()+1}, {temp[pk].max():.0f}F high"),
                   (wk, f"Winter peak {sysl[wk].max():.2f} kW/cust\n{DATES[wk]:%b %d}, {temp[wk].min():.0f}F low")]:
        ax.scatter([d], [sysl[d].max()], color=INK, s=30, zorder=3)
        ax.annotate(lab, (d, sysl[d].max()), xytext=(10, -2), textcoords="offset points", fontsize=9, va="top", color=INK)
    month_ticks(ax); ax.set_ylabel("Daily peak, kW per customer")
    ax.set_title("Today the population peaks in summer evenings (AC)", loc="left")
    ax = axes[1]
    cv = np.array(O["peak_flip_curve"])
    ax.plot(100 * cv[:, 0], cv[:, 1], color=BLUE, lw=2, label="Winter peak")
    ax.plot(100 * cv[:, 0], cv[:, 2], color=ORANGE, lw=2, ls="--", label="Summer peak (today)")
    f = O["hp_adoption_share_to_flip_peak"]
    if f is not None:
        ax.axvline(100 * f, color=INK2, lw=1, ls=":"); ax.text(100 * f + 0.8, cv[:, 1].min() + 0.05, f"Peak flips to winter\nat ~{100*f:.0f}% adoption", fontsize=9)
    ax.set_xlabel("% of homes adding a ducted heat pump"); ax.set_ylabel("kW per customer"); ax.legend(fontsize=9, loc="upper left")
    ax.set_title("Heat-pump adoption flips the peak to winter", loc="left")
    fig.tight_layout(); save(fig, f"{fig_dir}/04_system_peak.png")

    # 5. battery dispatch example (Tier 1 customer, own peak day)
    from bess import mode_a, mode_b, E_NOM, RESERVE, P_MAX
    t1 = R[R.tier.str.startswith("Tier 1")].sort_values("bpi", ascending=False)
    c = 32369 if 32369 in t1.index else t1.index[3]; i = idx[c]
    L = cube[i].astype(float)
    d = L.max(1).argmax()
    netA, DA = mode_a(L[None, d:d + 1], E_NOM * (1 - RESERVE), P_MAX)
    h = np.arange(1, 25)
    fig, ax = plt.subplots(figsize=(8.5, 4.4))
    ax.bar(h, L[d], color="#cde2fb", width=0.8, label="Load without battery")
    ax.plot(h, netA[0, 0], color=BLUE, lw=2.4, marker="o", ms=4, label="Grid draw with battery")
    ax.axhline(L[d].max(), color=INK2, lw=0.8, ls=":"); ax.axhline(netA[0, 0].max(), color=BLUE, lw=0.8, ls=":")
    ax.text(0.6, L[d].max() + 0.2, f"Peak {L[d].max():.1f} kW", fontsize=9, color=INK2)
    ax.text(0.6, netA[0, 0].max() + 0.2, f"Peak {netA[0, 0].max():.1f} kW  (-{L[d].max()-netA[0, 0].max():.1f} kW)", fontsize=9, color=BLUE)
    ax.set_xticks([1, 4, 8, 12, 16, 20, 24]); ax.set_xlabel("Hour ending"); ax.set_ylabel("kW")
    ax.set_title(f"Peak shaving on customer {c}'s peak day ({DATES[d]:%b %d}), 2 x Enphase IQ 10C", loc="left")
    ax.legend(fontsize=9, loc="upper left", bbox_to_anchor=(0, 0.9)); ax.grid(axis="x", visible=False)
    save(fig, f"{fig_dir}/05_dispatch_example.png")

    # 6. value by tier (stacked: capacity + TOU)
    tiers = ["Tier 1: deploy BESS", "Tier 2: offer BESS", "Tier 3: demand-flex program", "Tier 4: monitor"]
    g = R.groupby("tier")[["capacity_value", "tou_savings_b", "coinc_red_b"]].mean().reindex(tiers)
    cnt = R.tier.value_counts().reindex(tiers)
    fig, ax = plt.subplots(figsize=(8.5, 4.4))
    x = np.arange(len(tiers)); lbl = [t.replace(": ", "\n") + f"\n(n={cnt[t]:,})" for t in tiers]
    ax.bar(x, g.capacity_value, color=BLUE, width=0.6, label=f"Capacity relief at $100/kW-yr")
    ax.bar(x, g.tou_savings_b, bottom=g.capacity_value + 0, color=ORANGE, width=0.6, label="Customer TOU bill savings", edgecolor=SURF, linewidth=2)
    for xi, t in zip(x, tiers):
        tot = g.loc[t, "capacity_value"] + g.loc[t, "tou_savings_b"]
        ax.text(xi, tot + 8, f"${tot:,.0f}/yr\n{g.loc[t,'coinc_red_b']:.1f} kW at system peak", ha="center", fontsize=9, color=INK)
    ax.set_xticks(x); ax.set_xticklabels(lbl, fontsize=9); ax.set_ylabel("Annual value per battery ($)"); ax.set_ylim(0, (g.capacity_value + g.tou_savings_b).max() * 1.3)
    ax.legend(fontsize=9, loc="upper right"); ax.grid(axis="x", visible=False)
    ax.set_title("Targeting matters: Tier 1 batteries are worth 2.7x Tier 4", loc="left")
    save(fig, f"{fig_dir}/06_value_by_tier.png")

    # 7. electrification enablement (ECDF of incremental service peak)
    Ra = R[act]
    fig, axes = plt.subplots(1, 2, figsize=(14, 4.4), sharey=True)
    for ax, key, title in [(axes[0], "ev", "Adding a Level 2 EV charger (7.2 kW, 6-9 pm)"), (axes[1], "hp", "Adding a ducted heat pump (up to 6 kW)")]:
        for col, colr, lab in [(f"{key}_add_delta", ORANGE, "Without battery"), (f"{key}_add_delta_batt", BLUE, "With 2-unit battery")]:
            v = np.sort(Ra[col].values); ax.plot(v, np.arange(1, len(v) + 1) / len(v) * 100, color=colr, lw=2.2, label=lab)
        ax.axvline(3.0, color=INK, lw=1, ls="--"); ax.text(3.1, 4, "3 kVA limit\n(200 A service)", fontsize=9)
        ok0 = 100 * (Ra[f"{key}_add_delta"] <= 3).mean(); ok1 = 100 * (Ra[f"{key}_add_delta_batt"] <= 3).mean()
        ax.set_title(f"{title}\nwithin limit: {ok0:.0f}% -> {ok1:.0f}% of homes", loc="left", fontsize=11)
        ax.set_xlabel("Increase in customer annual peak (kW)")
    axes[0].set_ylabel("% of homes (cumulative)"); axes[0].legend(fontsize=9, loc="upper left")
    fig.tight_layout(); save(fig, f"{fig_dir}/07_enablement.png")

    # 8. EV model feature importance
    imp = pd.read_csv(f"{out}/classification_importance_EV.csv", index_col=0).iloc[:10, 0][::-1]
    nice = {"up_steps_5kw": "Hour-to-hour jumps >= 5 kW", "up_steps_5kw_warm": "Jumps >= 5 kW on warm days", "l2_events": "Flat 5-12 kW blocks (count)",
            "l2_level": "Level of 5-12 kW blocks", "max_kwh_h": "Max hourly kWh", "p99_kwh_h": "99th pct hourly kWh", "l2_night": "Share of blocks at night",
            "l2_warm": "Share of blocks on warm days", "mid_events": "Flat 3-5 kW blocks", "night_share": "Night share of energy", "cp_base": "Weather-normalised base kWh/day",
            "mid_warm": "3-5 kW blocks on warm days (share)", "mid_night": "3-5 kW blocks at night (share)", "pool_block_cv": "Day-to-day variability of 6-h block",
            "up_steps_3kw": "Hour-to-hour jumps 3-5 kW", "daily_peak_cv": "Variability of daily peaks", "load_factor": "Load factor", "annual_kwh": "Annual kWh",
            "l1_events": "Flat 1-2.2 kW overnight blocks", "base_kw": "Base load (5th pct)", "evening_share": "Evening share (HE17-21)"}
    for h in range(1, 25):
        nice[f"shape_he{h:02d}"] = f"Avg-day shape at HE{h}"
    for m in range(1, 13):
        nice[f"m{m:02d}_kwh"] = f"{pd.Timestamp(2026, m, 1):%B} kWh"
    fig, ax = plt.subplots(figsize=(7.5, 4.4))
    ax.barh([nice.get(k, k) for k in imp.index], 100 * imp.values, color=BLUE, height=0.6)
    ax.set_xlabel("Share of model gain (%)"); ax.grid(axis="y", visible=False)
    ax.set_title("What the EV model looks at (LightGBM PU, top 10 features)", loc="left")
    save(fig, f"{fig_dir}/08_ev_importance.png")

    # 9. segments: share of customers vs share of coincident peak
    seg = pd.DataFrame(O["segments"]).set_index("primary_segment")
    seg = seg.drop(index=[s for s in ["Inactive / low use"] if s in seg.index])
    seg["share_n"] = seg.n / seg.n.sum()
    seg = seg.sort_values("share_of_coincident_peak")
    fig, ax = plt.subplots(figsize=(8.5, 4.8))
    y = np.arange(len(seg))
    ax.barh(y - 0.2, 100 * seg.share_n, height=0.38, color="#86b6ef", label="% of customers")
    ax.barh(y + 0.2, 100 * seg.share_of_coincident_peak, height=0.38, color=BLUE, label="% of system-peak load")
    ax.set_yticks(y); ax.set_yticklabels(seg.index, fontsize=9); ax.set_xlabel("%"); ax.grid(axis="y", visible=False)
    ax.legend(fontsize=9, loc="lower right"); ax.set_title("Who drives the peak: segment share of customers vs. of peak load", loc="left")
    save(fig, f"{fig_dir}/09_segments_peak.png")
    print("figures written to", fig_dir)


if __name__ == "__main__":
    import argparse, sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(); ap.add_argument("--cube", default="data/cube.npz"); ap.add_argument("--out", default="outputs"); ap.add_argument("--fig", default="figures")
    a = ap.parse_args(); main(a.cube, a.out, a.fig)
