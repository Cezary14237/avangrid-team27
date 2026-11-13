"""Heatmap and archetype images in the deck palette (navy / blue / grey). Native charts are built in the deck itself."""
import json, os, sys, numpy as np, pandas as pd, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

NAVY, BLUE, GOLD, GREY, BG = "#1A2150", "#2A39B0", "#F8AB00", "#8A8FA8", "#F2F3F9"
CMAP = LinearSegmentedColormap.from_list("focal", ["#FFFFFF", "#DADDF0", "#8C96D8", BLUE, "#0B1660"])
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 7, "axes.edgecolor": "#C9CCD8", "xtick.color": "#4A4F6A",
                     "ytick.color": "#4A4F6A", "axes.labelcolor": "#4A4F6A", "axes.spines.top": False, "axes.spines.right": False})
DATES = pd.date_range("2025-09-01", periods=365)


def heat(cube, i, path):
    x = cube[i].T
    fig, ax = plt.subplots(figsize=(3.0, 1.75))
    im = ax.imshow(x, aspect="auto", cmap=CMAP, vmin=0, vmax=np.percentile(x, 99.5))
    starts = [k for k in range(365) if DATES[k].day == 1][::2]
    ax.set_xticks(starts); ax.set_xticklabels([DATES[k].strftime("%b") for k in starts], fontsize=6)
    ax.set_yticks([0, 6, 12, 18, 23]); ax.set_yticklabels(["1 am", "7 am", "1 pm", "7 pm", "12 am"], fontsize=6)
    cb = fig.colorbar(im, ax=ax, fraction=0.045, pad=0.02); cb.ax.tick_params(labelsize=6); cb.set_label("[kWh per hour]", fontsize=6)
    for s in ax.spines.values(): s.set_visible(False)
    fig.savefig(path, dpi=300, bbox_inches="tight", facecolor="white"); plt.close(fig)


def main(cube_path, out, fig_dir):
    os.makedirs(fig_dir, exist_ok=True)
    z = np.load(cube_path); cube, custs = z["cube"], z["custs"]
    idx = {c: i for i, c in enumerate(custs)}
    F = pd.read_pickle(f"{out}/features.pkl"); C = pd.read_csv(f"{out}/classification.csv", index_col=0).fillna({"ev_level": ""})
    picks = {"ev": C[(C.ev_level == "L2") & (C.label_EV == 1)].sort_values("p_ev_final").index[-1],
             "pv": C[C.label_PV == 1].join(F.solar_day_share_summer).sort_values("solar_day_share_summer").index[-5],
             "heat": C[C.eheat == 1].sort_values("p_eheat").index[-3]}
    for k, c in picks.items():
        heat(cube, idx[c], f"{fig_dir}/focal_heat_{k}.png")
    json.dump({k: int(v) for k, v in picks.items()}, open(f"{fig_dir}/focal_heat_customers.json", "w"))
    # archetypes (appendix)
    S = pd.read_csv(f"{out}/segments.csv", index_col=0)
    cen = np.load(f"{out}/segments_centers.npy"); names = json.load(open(f"{out}/segments_meta.json"))["names"]
    order = sorted(range(len(cen)), key=lambda i: -(S.archetype_id == i).sum())
    fig, axes = plt.subplots(2, 3, figsize=(8.6, 3.7), sharey=True)
    na = int((S.archetype_id >= 0).sum())
    for ax, i in zip(axes.flat, order):
        h = np.arange(1, 25)
        ax.plot(h, cen[i][:24], color=NAVY, lw=1.4, label="Winter")
        ax.plot(h, cen[i][24:48], color=BLUE, lw=1.4, ls="--", label="Summer")
        ax.plot(h, cen[i][48:], color=GREY, lw=1.2, label="Shoulder")
        n = int((S.archetype_id == i).sum())
        ax.set_title(f"{names[str(i)]}\n{n:,} homes, {100*n/na:.0f}% of active", fontsize=7, loc="left", color=NAVY, fontweight="bold")
        ax.set_xticks([1, 6, 12, 18, 24]); ax.tick_params(labelsize=6); ax.grid(False)
    axes[0, 0].legend(fontsize=6, frameon=False, loc="upper left")
    axes[0, 0].set_ylabel("[load / annual mean]", fontsize=6); axes[1, 0].set_ylabel("[load / annual mean]", fontsize=6)
    for ax in axes[1]: ax.set_xlabel("Hour ending", fontsize=6)
    fig.tight_layout(); fig.savefig(f"{fig_dir}/focal_archetypes.png", dpi=300, facecolor="white"); plt.close(fig)
    print("focal figures ok", picks)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(); ap.add_argument("--cube", default="data/cube.npz"); ap.add_argument("--out", default="outputs"); ap.add_argument("--fig", default="figures")
    a = ap.parse_args(); main(a.cube, a.out, a.fig)
