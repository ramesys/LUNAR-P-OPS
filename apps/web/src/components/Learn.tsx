import type { JSX, ReactNode } from "react";

/** RF-16: expanded explanations. Open by default in Simple mode, collapsed in Expert mode. */

interface LearnProps {
  title: string;
  open: boolean;
  children: ReactNode;
}

export function Learn({ title, open, children }: LearnProps): JSX.Element {
  return (
    <details className="learn" open={open}>
      <summary>{title}</summary>
      <div className="learn-body">{children}</div>
    </details>
  );
}

export function WhySouthPole({ open }: { open: boolean }): JSX.Element {
  return (
    <Learn title="Why land near the lunar south pole?" open={open}>
      <p>
        The Moon's axis is tilted only about 1.5°, so near the poles the Sun never climbs high: it circles
        close to the horizon once a month. High ridges can stay in sunlight for most of that circle, while
        the floors of deep craters never see the Sun at all. Those permanently shadowed craters may hold
        water ice, which is why missions want to go there.
      </p>
      <p>
        The Earth also stays low, drifting a few degrees up and down (the Moon's <em>libration</em>). A
        nearby hill can hide it for days, cutting direct radio contact. Choosing a site means balancing
        sunlight for power against a clear view of the Earth for communication.
      </p>
    </Learn>
  );
}

export function HowToReadSky({ open }: { open: boolean }): JSX.Element {
  return (
    <Learn title="How to read the sky diagram" open={open}>
      <p>
        Imagine standing at the site and looking all around. Left to right is the compass direction
        (north, east, south, west); up is how many degrees above the horizon something is. The grey
        silhouette is the real skyline made of hills and crater rims, from NASA's LOLA elevation data.
      </p>
      <p>
        The orange line is the path of the Sun and the blue line the path of the Earth. The thick part is
        the last 24 hours and the dot is the time shown. Whenever a line is hidden behind the grey
        skyline, that body is out of sight: no sunlight, or no direct contact with Earth.
      </p>
    </Learn>
  );
}

export function HowToReadTimeline({ open }: { open: boolean }): JSX.Element {
  return (
    <Learn title="How to read the timeline" open={open}>
      <p>
        The curves show how high the Sun (orange) and the Earth (blue) are above the local skyline over
        time. Above the 0° line they can be seen; below it they are hidden.
      </p>
      <p>
        The bars underneath summarize every site at once: an orange bar means sunlight, a blue bar means
        the Earth is in view (DTE, direct-to-Earth communication). Gaps are periods of darkness or radio
        silence. Press <strong>Play</strong> to watch the days go by.
      </p>
    </Learn>
  );
}

export function WhyTerrainMatters({ open }: { open: boolean }): JSX.Element {
  return (
    <Learn title="Why the terrain matters so much" open={open}>
      <p>
        With the Sun and the Earth only a few degrees above the horizon, a hill just 2° tall can block them
        for days. A calculation that ignores the terrain (a <em>flat horizon</em>) can make a dark crater
        look like a sunny spot and change which site comes out on top. This tool uses NASA's LOLA terrain
        for the catalog sites; in Expert mode you can switch to a flat horizon and compare.
      </p>
    </Learn>
  );
}
