"""Argo quality control policy (STEP 3B §7).

QC acceptance is defined in exactly one place — :class:`QCPolicy`, driven by
``settings.ACCEPTABLE_QC_FLAGS`` — so acceptance rules are configurable rather
than hard-coded as magic numbers at the comparison site.

Argo reference table 2
----------------------
=====  ==========================================
Flag   Meaning
=====  ==========================================
0      No QC performed
1      Good data
2      Probably good data
3      Bad data that are potentially correctable
4      Bad data
5      Value changed
8      Estimated / interpolated value
9      Missing value
=====  ==========================================

The default accepted set is ``{1, 2}``. Flag 9 (missing) is *never* acceptable
and is never interpreted as zero (§20).
"""
from __future__ import annotations

from typing import Dict, Iterable, Optional, Sequence, Tuple

import numpy as np

QC_FLAG_MEANINGS: Dict[int, str] = {
    0: "no QC performed",
    1: "good data",
    2: "probably good data",
    3: "bad data, potentially correctable",
    4: "bad data",
    5: "value changed",
    8: "estimated / interpolated value",
    9: "missing value",
}

QC_MISSING = 9


class QCPolicy:
    """Configurable Argo QC acceptance policy."""

    def __init__(
        self,
        acceptable_flags: Iterable[int] = (1, 2),
        name: str = "argo_reference_table_2",
        description: Optional[str] = None,
    ) -> None:
        flags = tuple(sorted({int(f) for f in acceptable_flags}))
        if not flags:
            raise ValueError("acceptable_flags must not be empty")
        if QC_MISSING in flags:
            raise ValueError(
                "QC flag 9 (missing value) must never be accepted as valid data"
            )
        self.acceptable_flags: Tuple[int, ...] = flags
        self.name = name
        self.description = description or (
            "Retain observations whose QC flag is in "
            f"{{{', '.join(str(f) for f in flags)}}}; exclude all others."
        )

    # ------------------------------------------------------------------
    def is_acceptable(self, flag: Optional[int]) -> bool:
        """A missing/None flag is not acceptable — absence is not evidence of good data."""
        if flag is None:
            return False
        try:
            return int(flag) in self.acceptable_flags
        except (TypeError, ValueError):
            return False

    def acceptable_mask(self, flags: Optional[Sequence[int]], n: int) -> np.ndarray:
        """Boolean mask of acceptable levels.

        When ``flags`` is ``None`` the QC variable is absent from the source. We
        cannot assert the data are good, but neither can we assert they are bad;
        an all-``True`` mask is returned and the caller is responsible for
        recording ``qc_flags_available = False`` in provenance so the absence is
        visible rather than hidden.
        """
        if flags is None:
            return np.ones(n, dtype=bool)
        arr = np.asarray(flags)
        return np.isin(arr.astype("int64"), np.asarray(self.acceptable_flags, dtype="int64"))

    def describe_flag(self, flag: Optional[int]) -> str:
        if flag is None:
            return "flag unavailable"
        return QC_FLAG_MEANINGS.get(int(flag), f"unrecognised flag {int(flag)}")

    def summarise(self, flags: Optional[Sequence[int]]) -> Dict[str, int]:
        """Histogram of QC flags, preserving the original QC information (§7)."""
        if flags is None:
            return {}
        arr = np.asarray(flags).astype("int64")
        values, counts = np.unique(arr, return_counts=True)
        return {str(int(v)): int(c) for v, c in zip(values, counts)}

    def as_metadata(self) -> Dict[str, object]:
        return {
            "policy": self.name,
            "acceptable_flags": list(self.acceptable_flags),
            "description": self.description,
        }


def default_policy() -> QCPolicy:
    """Policy built from application settings."""
    from app.core.config import settings

    return QCPolicy(
        acceptable_flags=settings.ACCEPTABLE_QC_FLAGS,
        name=settings.QC_POLICY_NAME,
        description=settings.QC_POLICY_DESCRIPTION,
    )
