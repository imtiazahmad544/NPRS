"""Database setup (SDS DD-04, SW-01).

PostgreSQL 15+ is the production store. SQLite is used for development and
for the test suite; the models avoid database-specific types so the same
code runs on both. All timestamps are stored in UTC (DB-04).
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.environ.get(
    "NPRS_DATABASE_URL", "sqlite:///./nprs.db"
)

_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=_connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from . import models  # noqa: F401  (register tables)
    Base.metadata.create_all(bind=engine)
