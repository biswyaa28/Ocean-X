"""Explicit model-time resolution and matching.

Two facts drive this module:

1. The installed model dataset covers its own window (the INCOIS runs on
   disk), which is generally NOT the window of the cyclone track being
   replayed. A request for a time the model does not cover can only ever be
   answered with *some* model state, so the resolution is made explicit here
   and the resolved label is always returned to the caller. Nothing downstream
   may assume the requested time is the time it got.
2. "Close enough" has to be a stated number. :data:`DEFAULT_MATCH_TOLERANCE_HOURS`
   is the single definition of time-matched used by the risk response and the
   UI, so the server and the client cannot disagree about it.

Deliberately dependency-free (stdlib only) so it can be imported by providers
and services alike without an import cycle.
"""

from datetime import datetime, timezone
from typing import List, Optional, Sequence

#: A model field is considered time-matched to a cyclone point when it is
#: within this many hours of it. Beyond it, the value describes a different
#: ocean state and must never be labelled as the storm's own.
DEFAULT_MATCH_TOLERANCE_HOURS = 48.0


def parse_timestamp(value: Optional[str]) -> Optional[datetime]:
    """Parse a timestamp into a naive UTC datetime, or ``None``.

    Accepts the shapes this application actually exchanges: NetCDF time labels
    (``2026-10-07T06:00:00.000000000``), client ISO strings with ``Z``, and the
    space-separated form NOAA/IBTrACS emits. Naive values are treated as UTC,
    which is what every producer here writes.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def hours_between(first: Optional[str], second: Optional[str]) -> Optional[float]:
    """Absolute hours between two timestamps, or ``None`` when unparseable.

    An unparseable input is *unknown*, never zero: reporting a zero-hour gap
    for a timestamp we could not read would mark a mismatched pair as matched.
    """
    a = parse_timestamp(first)
    b = parse_timestamp(second)
    if a is None or b is None:
        return None
    return abs((a - b).total_seconds()) / 3600.0


def is_time_matched(
    model_timestamp: Optional[str],
    point_timestamp: Optional[str],
    tolerance_hours: float = DEFAULT_MATCH_TOLERANCE_HOURS,
) -> bool:
    """True only when both times are known and within ``tolerance_hours``.

    Unknown on either side is NOT matched. That is the whole point of the
    function: a missing date is not evidence of agreement.
    """
    gap = hours_between(model_timestamp, point_timestamp)
    if gap is None:
        return False
    return gap <= tolerance_hours


def resolve_model_timestamp(
    requested: Optional[str],
    available: Sequence[str],
) -> Optional[str]:
    """Resolve a requested time against the model's own available times.

    Returns the label of the model time that will actually be served, or
    ``None`` when nothing can be served (no available times, or a request that
    cannot be understood).

    Rules, in order:

    * no available times -> ``None``;
    * no request -> the **latest** available time (the model's current state);
    * a request equal to an available label -> that label;
    * a parseable request that matches no label -> the **nearest** available
      label. This is the honest form of "no data at that time": the caller is
      told which time it is being given, instead of a hidden fall-back to the
      first entry;
    * a request that cannot be parsed -> ``None``.
    """
    if not available:
        return None

    parsed_available: List[tuple] = []
    for label in available:
        moment = parse_timestamp(label)
        if moment is not None:
            parsed_available.append((moment, label))
    if not parsed_available:
        return None

    if requested is not None and str(requested).strip():
        requested_moment = parse_timestamp(requested)
        if requested_moment is None:
            # A request we cannot read must not be answered with some other
            # time: the caller would then label the result with the storm's
            # date while holding a model's.
            return None
    else:
        # No request at all: serve the model's most recent state.
        return max(parsed_available, key=lambda item: item[0])[1]

    return min(parsed_available, key=lambda item: abs((item[0] - requested_moment).total_seconds()))[1]


def format_timestamp(value: Optional[str]) -> Optional[str]:
    """Render a timestamp as ``YYYY-MM-DD HH:MM UTC`` for user-facing labels."""
    parsed = parse_timestamp(value)
    if parsed is None:
        return None
    return parsed.strftime("%Y-%m-%d %H:%M UTC")