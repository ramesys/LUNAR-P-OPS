"""Continuous visibility windows from sampled flags (resolution: ±1 step, ADR 0006)."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class VisibilityWindow:
    start: datetime
    end: datetime
    visible: bool
    truncated: bool

    @property
    def duration(self) -> timedelta:
        return self.end - self.start


def build_windows(
    times: Sequence[datetime], flags: Sequence[bool], range_end: datetime
) -> list[VisibilityWindow]:
    """Group consecutive equal flags; each sample covers [t_i, t_{i+1}), the last one ends at
    `range_end`. Windows touching either edge of the range are marked truncated."""
    if len(times) != len(flags):
        raise ValueError("times and flags must have the same length")
    if not times:
        return []
    windows: list[VisibilityWindow] = []
    start_index: int = 0
    for i in range(1, len(flags) + 1):
        if i < len(flags) and flags[i] == flags[start_index]:
            continue
        end: datetime = times[i] if i < len(times) else range_end
        windows.append(
            VisibilityWindow(
                start=times[start_index],
                end=end,
                visible=flags[start_index],
                truncated=start_index == 0 or i == len(flags),
            )
        )
        start_index = i
    return windows


def longest(windows: Sequence[VisibilityWindow], *, visible: bool) -> VisibilityWindow | None:
    candidates: list[VisibilityWindow] = [w for w in windows if w.visible == visible]
    if not candidates:
        return None
    return max(candidates, key=lambda w: w.duration)
