"""Step 2: physics-informed customer features from the hourly cube + weather.

Every feature is explainable to a utility engineer:
  * level / shape:       annual kWh, base load, peaks, load factor, seasonal ratios
  * weather response:    change-point regression of daily kWh on daily mean temperature
                         kWh_d = b0 + bH * max(0, Th - T_d) + bC * max(0, T_d - Tc)
                         (balance points Th, Tc grid-searched per customer)
  * cold-weather shape:  slope below 25F vs slope 25-50F (heat pump COP drop / strip backup)
  * plateau events:      high-power, flat, multi-hour blocks above a rolling floor
                         (EV L1 ~1.4-1.9 kW, EV L2 ~6-11 kW, strip heat, water heater)
  * seasonal schedule:   fixed-hour summer uplift on cool days (pool pumps)
  * net-load zeros:      midday / evening zero runs (solar PV, PV + battery)
  * vacancy:             runs of days far below the customer's normal use (seasonal homes)
"""
import numpy as np, pandas as pd
from numpy.lib.stride_tricks import sliding_window_view as swv

DATES = pd.date_range("2025-09-01", periods=365)
MONTH = DATES.month.values
WEEKEND = (DATES.dayofweek.values >= 5)
SUMMER = np.isin(MONTH, [6, 7, 8])
WINTER = np.isin(MONTH, [12, 1, 2])
SHOULDER = np.isin(MONTH, [4, 5, 10])


def changepoint(daily, td):
    """Vectorised change-point OLS for all customers (temperature is shared, so one design per grid point)."""
    n = daily.shape[0]
    best = dict(sse=np.full(n, np.inf))
    tot = ((daily - daily.mean(1, keepdims=True)) ** 2).sum(1) + 1e-9
    for th in (45, 50, 55, 60, 65):
        for tc in (60, 65, 70, 75):
            if tc < th:
                continue
            A = np.c_[np.ones(365), np.maximum(0, th - td), np.maximum(0, td - tc)]
            coef, *_ = np.linalg.lstsq(A, daily.T, rcond=None)
            coef[1:] = np.maximum(coef[1:], 0)
            sse = ((A @ coef - daily.T) ** 2).sum(0)
            upd = sse < best["sse"]
            for k, v in dict(sse=sse, b0=coef[0], bh=coef[1], bc=coef[2],
                             th=np.full(n, th), tc=np.full(n, tc)).items():
                best.setdefault(k, np.zeros(n))
                best[k] = np.where(upd, v, best[k])
    hdd = {t: np.maximum(0, t - td).sum() for t in (45, 50, 55, 60, 65)}
    cdd = {t: np.maximum(0, td - t).sum() for t in (60, 65, 70, 75)}
    heat_kwh = best["bh"] * np.vectorize(hdd.get)(best["th"])
    cool_kwh = best["bc"] * np.vectorize(cdd.get)(best["tc"])
    return dict(cp_base=best["b0"], cp_heat_slope=best["bh"], cp_cool_slope=best["bc"],
                cp_th=best["th"], cp_tc=best["tc"], cp_r2=1 - best["sse"] / tot,
                heat_kwh_yr=heat_kwh, cool_kwh_yr=cool_kwh)


def plateau_events(s, temp_flat, hour_flat, lo, hi, min_len, max_len, floor_win=25, cv_max=0.35):
    """Count flat multi-hour blocks whose rise above a rolling floor sits in [lo, hi) kWh/h.

    s: [n, 8760] hourly kWh. Floor = rolling minimum over +/- floor_win//2 hours.
    Returns counts, mean level, share at night (HE 21-06), share when T > 55F.
    """
    n, L = s.shape
    pad = floor_win // 2
    sp = np.pad(s, ((0, 0), (pad, pad)), mode="edge")
    floor = swv(sp, floor_win, axis=1).min(-1)
    r = s - floor
    on = (r >= lo) & (r < hi)
    out = np.zeros((n, 4), dtype=np.float32)
    for i in range(n):
        o = on[i]
        if not o.any():
            continue
        d = np.diff(np.r_[0, o.astype(np.int8), 0])
        st, en = np.where(d == 1)[0], np.where(d == -1)[0]
        ln = en - st
        keep = (ln >= min_len) & (ln <= max_len)
        if not keep.any():
            continue
        st, en = st[keep], en[keep]
        lvl, ok = [], []
        for a, b in zip(st, en):
            seg = r[i, a:b]
            m = seg.mean()
            if seg.std() / (m + 1e-6) <= cv_max:
                ok.append(a); lvl.append(m)
        if not ok:
            continue
        ok = np.array(ok)
        hrs = hour_flat[ok]
        out[i] = (len(ok), np.mean(lvl), np.mean((hrs >= 20) | (hrs <= 5)), np.mean(temp_flat[ok] > 55))
    return out


def longest_zero_run(x):
    """x: [n, 365, 24] -> share of days with >= 12 consecutive ~zero hours, per customer."""
    z = (x < 0.02).astype(np.int8)
    best = np.zeros(x.shape[:2], dtype=np.int8)
    cur = np.zeros(x.shape[:2], dtype=np.int8)
    for h in range(24):
        cur = (cur + 1) * z[:, :, h]
        best = np.maximum(best, cur)
    return best


def compute(custs, cube, temp, chunk=2000):
    n = len(custs)
    td = temp.mean(1)
    tflat = temp.ravel()
    hflat = np.tile(np.arange(24), 365)
    F = pd.DataFrame(index=pd.Index(custs, name="cust"))
    daily = cube.sum(2)
    flat = cube.reshape(n, -1)

    # --- level & shape
    F["annual_kwh"] = daily.sum(1)
    F["mean_kw"] = flat.mean(1)
    F["max_kwh_h"] = flat.max(1)
    F["p99_kwh_h"] = np.percentile(flat, 99, axis=1)
    F["p95_kwh_h"] = np.percentile(flat, 95, axis=1)
    F["base_kw"] = np.percentile(flat, 5, axis=1)
    F["load_factor"] = F.mean_kw / (F.max_kwh_h + 1e-6)
    F["base_share"] = F.base_kw * 8760 / (F.annual_kwh + 1e-6)
    for m in range(1, 13):
        F[f"m{m:02d}_kwh"] = daily[:, MONTH == m].sum(1)
    sh = daily[:, SHOULDER].mean(1) + 1e-6
    F["winter_ratio"] = daily[:, WINTER].mean(1) / sh
    F["summer_ratio"] = daily[:, SUMMER].mean(1) / sh
    F["weekend_ratio"] = daily[:, WEEKEND].mean(1) / (daily[:, ~WEEKEND].mean(1) + 1e-6)
    prof = cube.mean(1)                                        # average day [n, 24]
    F["night_share"] = prof[:, list(range(0, 6)) + [22, 23]].sum(1) / (prof.sum(1) + 1e-6)
    F["evening_share"] = prof[:, 16:21].sum(1) / (prof.sum(1) + 1e-6)   # HE17-21
    F["midday_share"] = prof[:, 10:15].sum(1) / (prof.sum(1) + 1e-6)    # HE11-15
    F["peak_hour"] = prof.argmax(1) + 1
    F["daily_peak_cv"] = cube.max(2).std(1) / (cube.max(2).mean(1) + 1e-6)

    # --- weather response
    for k, v in changepoint(daily, td).items():
        F[k] = v
    F["heat_share"] = F.heat_kwh_yr / (F.annual_kwh + 1e-6)
    F["cool_share"] = F.cool_kwh_yr / (F.annual_kwh + 1e-6)
    cold, mild = td < 25, (td >= 25) & (td < 50)
    def slope(mask):
        x = td[mask]; y = daily[:, mask]
        xc = x - x.mean()
        return -(y - y.mean(1, keepdims=True)) @ xc / (xc @ xc)
    F["slope_cold"] = slope(cold)        # kWh/day per degF drop below 25F
    F["slope_mild"] = slope(mild)
    F["cold_steepening"] = F.slope_cold / (F.slope_mild.clip(lower=0.05))
    # summer afternoon hourly temperature sensitivity (AC): kWh/h per degF, HE13-20, Jun-Aug
    hs = cube[:, SUMMER][:, :, 12:20].reshape(n, -1)
    tt = temp[SUMMER][:, 12:20].ravel(); tc = tt - tt.mean()
    F["ac_hourly_slope"] = (hs - hs.mean(1, keepdims=True)) @ tc / (tc @ tc)
    hot = tt >= 85
    F["ac_kw_hot"] = hs[:, hot].mean(1) - hs[:, (tt >= 60) & (tt < 68)].mean(1)
    # winter hourly sensitivity
    hw = cube[:, WINTER].reshape(n, -1); tw = temp[WINTER].ravel(); twc = tw - tw.mean()
    F["heat_hourly_slope"] = -(hw - hw.mean(1, keepdims=True)) @ twc / (twc @ twc)
    F["winter_peak_kw"] = np.percentile(hw, 99, axis=1)

    # --- plateau events (EV signatures)
    ev = []
    for a in range(0, n, chunk):
        s = flat[a:a + chunk]
        l2 = plateau_events(s, tflat, hflat, 5.0, 12.5, 1, 8, floor_win=13, cv_max=0.3)
        l2b = plateau_events(s, tflat, hflat, 3.0, 5.0, 2, 8, floor_win=13, cv_max=0.3)
        l1 = plateau_events(s, tflat, hflat, 1.0, 2.2, 5, 14, floor_win=37, cv_max=0.25)
        ev.append(np.c_[l2, l2b, l1])
    ev = np.vstack(ev)
    cols = []
    for p in ("l2", "mid", "l1"):
        cols += [f"{p}_events", f"{p}_level", f"{p}_night", f"{p}_warm"]
    for j, c in enumerate(cols):
        F[c] = ev[:, j]
    # big hour-over-hour steps (on/off edges of large loads)
    dif = np.diff(flat, axis=1)
    F["up_steps_5kw"] = (dif >= 5).sum(1)
    F["up_steps_3kw"] = ((dif >= 3) & (dif < 5)).sum(1)
    F["up_steps_5kw_warm"] = ((dif >= 5) & (tflat[1:] > 55)).sum(1)

    # --- pool pump: fixed-hour uplift on cool summer days vs shoulder months
    cool_summer = SUMMER & (td < 72)
    shoulder_cool = np.isin(MONTH, [4, 10, 11]) & (td > 40) & (td < 62)
    up = np.median(cube[:, cool_summer], axis=1) - np.median(cube[:, shoulder_cool], axis=1)  # [n,24]
    w = swv(up, 6, axis=1).min(-1)               # best 6-hour rectangle (min uplift inside it)
    F["pool_uplift_6h"] = w.max(1)
    F["pool_block_start"] = w.argmax(1) + 1
    F["pool_uplift_night"] = np.median(up[:, :5], axis=1)
    # day-to-day regularity of that block in summer (pump timers repeat exactly)
    bs = w.argmax(1)
    blk = np.stack([cube[i][:, bs[i]:bs[i] + 6].mean(1) for i in range(n)])
    F["pool_summer_step"] = blk[:, SUMMER].mean(1) - blk[:, np.isin(MONTH, [4, 11])].mean(1)
    F["pool_block_cv"] = blk[:, SUMMER].std(1) / (blk[:, SUMMER].mean(1) + 1e-6)
    # rectangle contrast: uplift inside the block vs the rest of the day (pool timers are hour-specific)
    inside = np.zeros_like(up, dtype=bool)
    for i in range(n):
        inside[i, bs[i]:bs[i] + 6] = True
    F["pool_contrast"] = np.nanmean(np.where(inside, up, np.nan), 1) - np.nanmean(np.where(~inside, up, np.nan), 1)
    # temperature independence of the block within summer (AC follows temperature, pumps do not)
    ts = td[SUMMER]; tsc = ts - ts.mean(); bsm = blk[:, SUMMER]
    F["pool_temp_corr"] = ((bsm - bsm.mean(1, keepdims=True)) @ tsc) / (np.sqrt(((bsm - bsm.mean(1, keepdims=True)) ** 2).sum(1)) * np.linalg.norm(tsc) + 1e-6)

    # --- solar: zeros at midday, battery: long zero runs and evening zeros
    zero = cube < 0.02
    F["zero_share"] = zero.mean((1, 2))
    F["midday_zero_share"] = zero[:, :, 10:15].mean((1, 2))
    F["summer_midday_zero"] = zero[:, SUMMER][:, :, 10:15].mean((1, 2))
    F["evening_zero_share"] = zero[:, :, 18:23].mean((1, 2))
    F["night_zero_share"] = zero[:, :, 0:5].mean((1, 2))
    F["summer_midday_dip"] = cube[:, SUMMER][:, :, 10:15].mean((1, 2)) / (
        cube[:, SUMMER][:, :, np.r_[6:9, 17:21]].mean((1, 2)) + 1e-6)
    # solar-signature day: midday net load ~0 while the home is clearly occupied at night/evening
    occ = (cube[:, :, np.r_[0:5, 19:23]].mean(2) > 0.2)
    sday = zero[:, :, 10:15].all(2) & occ
    F["solar_day_share"] = sday.mean(1)
    F["solar_day_share_summer"] = sday[:, SUMMER].mean(1)
    # first month with sustained solar days (detects PV installed mid-year)
    msh = np.stack([sday[:, MONTH == m].mean(1) for m in [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8]], 1)
    F["solar_first_month_idx"] = np.where((msh > 0.2).any(1), (msh > 0.2).argmax(1), -1)
    F["solar_sep_oct"] = msh[:, :2].mean(1)
    F["solar_jun_aug"] = msh[:, 9:].mean(1)
    # battery-like day: >=12 consecutive zero hours that reach into the evening (HE19+)
    zr = longest_zero_run(cube)
    occupied = cube[:, :, np.r_[0:6, 23]].sum(2) > 1.0          # imports overnight => home in use
    F["battery_like_days"] = (zero[:, :, 19:22].all(2) & zero[:, :, 10:14].all(2) & occupied).sum(1)
    F["days_zero_run12"] = (zr >= 12).mean(1)
    F["days_zero_run6"] = (zr >= 6).mean(1)

    # --- vacancy / seasonal occupancy
    med = np.median(daily, axis=1, keepdims=True)
    low = daily < 0.35 * med
    run = np.zeros(n); cur = np.zeros(n)
    for d in range(365):
        cur = (cur + 1) * low[:, d]; run = np.maximum(run, cur)
    F["vacant_days"] = low.sum(1)
    F["longest_vacancy"] = run
    F["month_cv"] = F[[f"m{m:02d}_kwh" for m in range(1, 13)]].std(axis=1) / (F[[f"m{m:02d}_kwh" for m in range(1, 13)]].mean(axis=1) + 1e-6)

    # --- water heater: shoulder-month morning/evening bumps over night floor
    shp = np.median(cube[:, np.isin(MONTH, [5, 9, 10])], axis=1)
    F["wh_morning_bump"] = shp[:, 5:9].max(1) - shp[:, 1:4].min(1)
    F["wh_evening_bump"] = shp[:, 17:22].max(1) - shp[:, 1:4].min(1)

    # --- temperature-binned load curve (daily kWh per bin / mild-day kWh): full weather "signature"
    bins = [-50, 10, 20, 30, 40, 50, 60, 70, 75, 80, 120]
    tb = np.digitize(td, bins) - 1
    mild = daily[:, (td >= 60) & (td < 70)].mean(1) + 1e-6
    for b in range(len(bins) - 1):
        if b == 6:
            continue
        m = tb == b
        F[f"tbin_{bins[b]}_{bins[b+1]}"] = daily[:, m].mean(1) / mild if m.any() else 1.0
    # --- heating-season shape: heat pumps run long and flat; resistance/strip is peaky with setback spikes
    wcube = cube[:, WINTER]
    wh = wcube.reshape(n, -1)
    F["winter_flatness"] = np.median(wh, axis=1) / (np.percentile(wh, 95, axis=1) + 1e-6)
    wp = wcube.mean(1)
    F["winter_morning_spike"] = wp[:, 5:9].mean(1) / (wp[:, 0:4].mean(1) + 1e-6)
    F["winter_night_share"] = wp[:, [0, 1, 2, 3, 4, 22, 23]].sum(1) / (wp.sum(1) + 1e-6)
    sm = (td >= 45) & (td < 60)
    x = td[sm] - td[sm].mean()
    F["shoulder_heat_slope"] = -(daily[:, sm] - daily[:, sm].mean(1, keepdims=True)) @ x / (x @ x)
    tw = temp[WINTER].ravel()
    whc = wh - wh.mean(1, keepdims=True)
    F["winter_hourly_corr"] = -(whc @ (tw - tw.mean())) / (np.sqrt((whc ** 2).sum(1)) * np.linalg.norm(tw - tw.mean()) + 1e-6)
    # --- normalised average-day shape (24 values) and weekday night share
    np_prof = prof / (prof.mean(1, keepdims=True) + 1e-6)
    for h in range(24):
        F[f"shape_he{h+1:02d}"] = np_prof[:, h]
    return F.astype(np.float32)


if __name__ == "__main__":
    import argparse, time
    ap = argparse.ArgumentParser(); ap.add_argument("--cube", default="data/cube.npz"); ap.add_argument("--out", default="outputs/features.pkl")
    a = ap.parse_args(); t = time.time()
    z = np.load(a.cube)
    F = compute(z["custs"], z["cube"], z["temp"])
    F.to_pickle(a.out)
    print(F.shape, f"{time.time()-t:.0f}s")
