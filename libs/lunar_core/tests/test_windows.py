from datetime import UTC, datetime, timedelta

import pytest
from lunar_core.windows import VisibilityWindow, build_windows, longest

T0 = datetime(2026, 1, 1, tzinfo=UTC)
HOUR = timedelta(hours=1)


def hours(n: int) -> list[datetime]:
    return [T0 + i * HOUR for i in range(n)]


def test_groups_consecutive_flags_and_marks_edges_truncated():
    windows = build_windows(hours(6), [True, True, False, False, False, True], T0 + 6 * HOUR)

    assert windows == [
        VisibilityWindow(T0, T0 + 2 * HOUR, visible=True, truncated=True),
        VisibilityWindow(T0 + 2 * HOUR, T0 + 5 * HOUR, visible=False, truncated=False),
        VisibilityWindow(T0 + 5 * HOUR, T0 + 6 * HOUR, visible=True, truncated=True),
    ]


def test_single_window_covers_whole_range():
    windows = build_windows(hours(3), [False, False, False], T0 + 3 * HOUR)

    assert windows == [VisibilityWindow(T0, T0 + 3 * HOUR, visible=False, truncated=True)]
    assert windows[0].duration == 3 * HOUR


def test_empty_input_gives_no_windows():
    assert build_windows([], [], T0) == []


def test_length_mismatch_is_rejected():
    with pytest.raises(ValueError, match="same length"):
        build_windows(hours(2), [True], T0 + 2 * HOUR)


def test_longest_picks_by_duration_and_visibility():
    windows = build_windows(hours(7), [False, True, True, True, False, False, True], T0 + 7 * HOUR)

    longest_light = longest(windows, visible=True)
    longest_dark = longest(windows, visible=False)

    assert longest_light is not None
    assert longest_light.duration == 3 * HOUR
    assert longest_dark is not None
    assert longest_dark.duration == 2 * HOUR
    assert longest(windows[1:2], visible=False) is None
