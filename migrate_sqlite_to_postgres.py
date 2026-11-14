"""Copy a local SQLite Research OS database into an empty PostgreSQL database."""

from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

import psycopg
from psycopg.conninfo import conninfo_to_dict
from psycopg.rows import dict_row

from app import PostgresConnection, SCHEMA_PATH


TABLES = (
    "users",
    "research_projects",
    "documents",
    "document_versions",
    "research_sources",
    "appendices",
    "statistical_analyses",
    "writing_analyses",
    "ai_generation_history",
)


def migrate(source_path: Path, database_url: str) -> int:
    if not source_path.is_file():
        raise FileNotFoundError(f"SQLite source database does not exist: {source_path}")
    if not database_url:
        raise ValueError("Set DATABASE_URL to the Supabase/PostgreSQL connection URI.")

    source = sqlite3.connect(source_path)
    source.row_factory = sqlite3.Row
    try:
        options = conninfo_to_dict(database_url)
        options.setdefault("sslmode", "require")
        with psycopg.connect(**options, row_factory=dict_row, connect_timeout=10) as raw_target:
            target = PostgresConnection(raw_target)
            target.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
            for table in TABLES:
                count = target.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()["count"]
                if count:
                    raise ValueError(
                        f"Target table {table!r} is not empty. Migration stopped without changing source data."
                    )

            total = 0
            for table in TABLES:
                rows = source.execute(f"SELECT * FROM {table}").fetchall()
                if not rows:
                    continue
                columns = list(rows[0].keys())
                names = ", ".join(f'"{column}"' for column in columns)
                placeholders = ", ".join("%s" for _ in columns)
                statement = f'INSERT INTO "{table}" ({names}) VALUES ({placeholders})'
                for row in rows:
                    target.execute(statement, tuple(row[column] for column in columns))
                total += len(rows)
            raw_target.commit()
            return total
    except Exception:
        if "raw_target" in locals():
            raw_target.rollback()
        raise
    finally:
        source.close()


if __name__ == "__main__":
    source_database = Path(os.environ.get(
        "SOURCE_DATABASE_PATH",
        str(Path(__file__).resolve().parent / "instance" / "research-os.sqlite3"),
    ))
    try:
        migrated_rows = migrate(source_database, os.environ.get("DATABASE_URL", "").strip())
    except (OSError, ValueError, psycopg.Error) as error:
        print(f"Migration failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
    print(f"Copied {migrated_rows} rows. The SQLite source was left unchanged.")
