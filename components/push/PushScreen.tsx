"use client";

import { useMemo, useState } from "react";
import type { FeedAlert, Tier } from "@/types/push";
import { AttentionCard, ReviewRow } from "./AlertRow";
import { clockLabel, plural } from "./format";
import { applyPrefs, usePrefs } from "./prefs";
import { RoutineFold } from "./RoutineFold";
import { SettingsSheet } from "./SettingsSheet";
import { usePushFeed } from "./usePushFeed";
import { WindowPicker } from "./WindowPicker";
import "./push.css";

const windowName = (h: number) => (h < 24 ? `${h} hours` : h === 24 ? "24 hours" : `${h / 24} days`);

export function PushScreen() {
  const [hours, setHours] = useState(24);
  const [settings, setSettings] = useState(false);
  const { prefs, setPrefs, ready } = usePrefs();
  const { data, error, loading, refresh } = usePushFeed(hours);
  const now = useMemo(() => Date.now(), [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Server tiers are a starting point; this investor's thresholds decide what is shown and how it ranks.
  const alerts = useMemo(() => (data ? applyPrefs(data.alerts, prefs) : []), [data, prefs]);

  const groups = useMemo(() => {
    const g: Record<Tier, FeedAlert[]> = { attention: [], review: [], routine: [] };
    alerts.forEach((a) => g[a.tier].push(a));
    return g;
  }, [alerts]);

  const filteredOut = !!data && data.alerts.length > 0 && alerts.length === 0;

  return (
    <main className="push" aria-busy={loading}>
      <header className="top">
        <div className="topRow">
          <h1>Portfolio feed</h1>
          <button type="button" className="icon" onClick={() => setSettings(true)} aria-label="Set what counts as unusual" aria-haspopup="dialog">
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
              <path d="M3 6h9M16 6h1M3 14h1M8 14h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
              <circle cx="14" cy="6" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="6" cy="14" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </div>
        <div className="topRow sub">
          <WindowPicker value={hours} onChange={setHours} />
          {data?.generatedAt && (
            <button type="button" className="refresh" onClick={refresh} disabled={loading}>
              {loading ? "Updating" : `Updated ${clockLabel(data.generatedAt)}`}
            </button>
          )}
        </div>
      </header>

      {error && !data && (
        <div className="state" role="alert">
          <p className="lead">{error}</p>
          <button type="button" className="primary" onClick={refresh}>Try again</button>
        </div>
      )}

      {(!data || !ready) && !error && (
        <div className="state" role="status">
          <div className="skel tall" /><div className="skel" /><div className="skel" />
        </div>
      )}

      {data && ready && (
        <>
          <p className="digest">
            {alerts.length === 0
              ? filteredOut
                ? `Your thresholds are hiding everything from the last ${windowName(hours)}.`
                : `Nothing filed or flagged in the last ${windowName(hours)}.`
              : <>
                  <b>{groups.attention.length}</b> {groups.attention.length === 1 ? "needs" : "need"} attention,{" "}
                  <b>{groups.review.length}</b> worth a look, {plural(groups.routine.length, "routine filing")} tucked away.
                </>}
          </p>

          {error && <p className="note bad pad" role="alert">{error} Showing the last loaded feed.</p>}

          {alerts.length === 0 && (
            <div className="state">
              <p className="note">
                {filteredOut ? "Loosen the volume or price thresholds to see smaller moves." : "Anything that crosses your thresholds will appear here."}
              </p>
              <div className="actions">
                {!filteredOut && hours < 168 && <button type="button" className="primary" onClick={() => setHours(168)}>Look back 7 days</button>}
                <button type="button" className={filteredOut ? "primary" : "ghost"} onClick={() => setSettings(true)}>Adjust thresholds</button>
              </div>
            </div>
          )}

          {groups.attention.length > 0 && (
            <section aria-labelledby="att-h" className="tier">
              <h2 id="att-h" className="tierTitle">Needs attention</h2>
              <div className="stack">
                {groups.attention.map((a) => <AttentionCard key={a.id} a={a} now={now} />)}
              </div>
            </section>
          )}

          {groups.review.length > 0 && (
            <section aria-labelledby="rev-h" className="tier">
              <h2 id="rev-h" className="tierTitle">Worth a look</h2>
              <ul className="rlist">
                {groups.review.map((a) => <ReviewRow key={a.id} a={a} now={now} />)}
              </ul>
            </section>
          )}

          <RoutineFold items={groups.routine} now={now} />
        </>
      )}

      <SettingsSheet
        open={settings}
        prefs={prefs}
        attentionCount={groups.attention.length}
        onChange={setPrefs}
        onClose={() => setSettings(false)}
      />
    </main>
  );
}