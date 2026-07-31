from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"


def test_non_production_runner_requires_expected_artifacts_before_connecting():
    runner = (MIGRATIONS / "validate-non-production.ps1").read_text(encoding="utf-8")

    for migration in (
        "001_add_expense_metadata.sql",
        "002_corrections_and_rpcs.sql",
        "003_accuracy_and_trend_rpcs.sql",
    ):
        assert migration in runner
    assert "-ConfirmNonProduction" in runner
    assert "No database connection was opened" in runner
    assert "foreach ($pass in 1..2)" in runner


def test_sql_harness_covers_required_non_production_checks():
    checks = (MIGRATIONS / "validate_expansion_migrations.sql").read_text(
        encoding="utf-8"
    )

    for marker in (
        "financial fields changed during migration",
        "historical metadata must remain nullable",
        "correction change was not atomic",
        "failed correction did not roll back",
        "latest correction ordering is incorrect",
        "unsupported correction category was accepted",
        "corrected expense deletion was not restricted",
        "rollback;",
    ):
        assert marker in checks
