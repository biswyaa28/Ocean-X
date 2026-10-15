"""Time-matching contract for model-derived values.

The application replays historical cyclone tracks (2020-2025) against a model
dataset that covers a completely different window (the installed HYCOM runs).
Nothing derived from the model may ever be presented under a date it does not
belong to, so timestamp resolution and the "is this the storm's date?" decision
are pure, explicit functions with tests of their own.
"""

from app.services.model_time_matching import (
    DEFAULT_MATCH_TOLERANCE_HOURS,
    format_timestamp,
    hours_between,
    is_time_matched,
    resolve_model_timestamp,
)


class TestResolveModelTimestamp:
    def test_no_available_times_returns_none(self):
        assert resolve_model_timestamp("2020-05-18T12:00:00", []) is None

    def test_absent_request_uses_the_latest_available_model_time(self):
        available = [
            "2026-10-07T06:00:00.000000000",
            "2026-10-08T18:00:00.000000000",
        ]
        assert resolve_model_timestamp(None, available) == "2026-10-08T18:00:00.000000000"

    def test_exact_request_is_returned_unchanged(self):
        available = ["2026-10-07T06:00:00.000000000", "2026-10-07T12:00:00.000000000"]
        assert (
            resolve_model_timestamp("2026-10-07T12:00:00.000000000", available)
            == "2026-10-07T12:00:00.000000000"
        )

    def test_equivalent_representations_resolve_to_the_available_entry(self):
        """A client ISO string is not string-equal to the NetCDF time label.

        Comparing the raw strings made a request for a time that IS in the
        dataset fall through to the first entry instead of its own time.
        """
        available = ["2026-10-07T06:00:00.000000000", "2026-10-07T12:00:00.000000000"]
        assert (
            resolve_model_timestamp("2026-10-07T12:00:00Z", available)
            == "2026-10-07T12:00:00.000000000"
        )

    def test_unmatched_but_parseable_request_resolves_to_the_nearest_model_time(self):
        available = [
            "2026-10-07T06:00:00.000000000",
            "2026-10-08T18:00:00.000000000",
        ]
        # 2020 is far outside the window; nearest is the closest edge.
        assert (
            resolve_model_timestamp("2020-05-18T12:00:00", available)
            == "2026-10-07T06:00:00.000000000"
        )
        assert (
            resolve_model_timestamp("2030-01-01T00:00:00", available)
            == "2026-10-08T18:00:00.000000000"
        )

    def test_unparseable_request_returns_none(self):
        available = ["2026-10-07T06:00:00.000000000"]
        assert resolve_model_timestamp("not-a-date", available) is None

    def test_unparseable_available_entry_is_skipped(self):
        available = ["garbage", "2026-10-07T06:00:00.000000000"]
        assert resolve_model_timestamp(None, available) == "2026-10-07T06:00:00.000000000"


class TestHoursBetween:
    def test_same_instant_is_zero(self):
        assert hours_between("2026-10-07T06:00:00", "2026-10-07 06:00:00.000000000") == 0.0

    def test_is_symmetric(self):
        a, b = "2026-10-07T06:00:00", "2026-10-08T06:00:00"
        assert hours_between(a, b) == hours_between(b, a) == 24.0

    def test_utc_offsets_are_normalised(self):
        assert hours_between("2026-10-07T06:00:00Z", "2026-10-07T12:00:00+02:00") == 4.0

    def test_unparseable_input_is_unknown_not_zero(self):
        assert hours_between("2026-10-07T06:00:00", "nonsense") is None


class TestIsTimeMatched:
    def test_within_tolerance_is_matched(self):
        assert is_time_matched("2026-10-07T06:00:00", "2026-10-08T06:00:00") is True

    def test_exactly_at_tolerance_is_matched(self):
        hours = DEFAULT_MATCH_TOLERANCE_HOURS
        assert (
            is_time_matched(
                "2026-10-07T06:00:00",
                "2026-10-09T06:00:00",
                tolerance_hours=hours,
            )
            is True
        )

    def test_years_apart_is_not_matched(self):
        assert is_time_matched("2026-10-07T06:00:00", "2020-05-18T12:00:00") is False

    def test_unknown_model_time_is_not_matched(self):
        assert is_time_matched(None, "2020-05-18T12:00:00") is False
        assert is_time_matched("", "2020-05-18T12:00:00") is False

    def test_unknown_storm_time_is_not_matched(self):
        assert is_time_matched("2026-10-07T06:00:00", None) is False


class TestFormatTimestamp:
    def test_formats_a_utc_minute_stamp(self):
        assert format_timestamp("2026-10-07T06:00:00.000000000") == "2026-10-07 06:00 UTC"

    def test_accepts_a_space_separated_stamp(self):
        assert format_timestamp("2020-05-18 12:00:00") == "2020-05-18 12:00 UTC"

    def test_missing_or_unparseable_returns_none(self):
        assert format_timestamp(None) is None
        assert format_timestamp("not-a-date") is None