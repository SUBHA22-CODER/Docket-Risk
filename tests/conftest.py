"""Shared pytest fixtures.

Environment for the scoring service is fixed BEFORE the module under test is
imported, because settings are validated at import time.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

_TMP = tempfile.mkdtemp(prefix="ring_sentinel_test_")
os.environ.setdefault("RING_SENTINEL_API_KEYS", "test-key-123")
os.environ.setdefault("RING_SENTINEL_SNAPSHOT", os.path.join(_TMP, "snap.json"))
os.environ.setdefault("RING_SENTINEL_AUDIT_DB", os.path.join(_TMP, "audit.db"))
os.environ.setdefault("RING_SENTINEL_RATE_LIMIT", "100000")
os.environ.setdefault("RING_SENTINEL_LOG_LEVEL", "WARNING")

import pytest
from fastapi.testclient import TestClient

from src import score_service as ss

API_KEY = os.environ["RING_SENTINEL_API_KEYS"]
AUTH = {"X-API-Key": API_KEY}


@pytest.fixture(scope="session")
def client():
    with TestClient(ss.app) as c:
        yield c


@pytest.fixture()
def fresh_state():
    ss.state.__init__(ss.SETTINGS)
    return ss.state
