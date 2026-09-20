"""Unit tests for project stage normalization."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import project_stages as ps


def test_defaults():
    stages = ps.normalize_project_stages(None)
    assert len(stages) == 4
    assert ps.final_stage_key(None) == "completed"
    assert sum(1 for s in stages if s.get("is_final")) == 1


def test_custom_labels_and_final():
    stages = ps.normalize_project_stages([
        {"key": "planning", "label": "Keşif", "tone": "violet"},
        {"key": "active", "label": "Şantiye", "tone": "blue"},
        {"key": "bitis", "label": "Teslim", "tone": "emerald", "is_final": True},
    ])
    assert stages[0]["label"] == "Keşif"
    assert stages[0]["tone"] == "violet"
    assert ps.final_stage_key(stages) == "bitis"


def test_forces_final_and_slug():
    stages = ps.normalize_project_stages([
        {"label": "Montaj Aşaması"},
        {"label": "Kontrol"},
    ])
    assert stages[0]["key"].startswith("montaj")
    assert stages[-1]["is_final"] is True
