"""
Database Initialization
"""
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings


engine_kwargs = {
    'echo': settings.DEBUG,
    'pool_pre_ping': True,
}

if settings.DATABASE_URL.startswith('sqlite'):
    engine_kwargs['connect_args'] = {'check_same_thread': False}
else:
    engine_kwargs['pool_size'] = 10
    engine_kwargs['max_overflow'] = 20

engine = create_engine(settings.DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Dependency to get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _ensure_schema_compatibility():
    """Apply lightweight schema compatibility fixes for local MVP usage."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    if 'tasks' in tables:
        columns = {column['name'] for column in inspector.get_columns('tasks')}
        statements = []

        if 'eval_backend' not in columns:
            statements.append("ALTER TABLE tasks ADD COLUMN eval_backend VARCHAR(64) DEFAULT 'Native' NOT NULL")
        if 'current_step' not in columns:
            statements.append('ALTER TABLE tasks ADD COLUMN current_step VARCHAR(255)')

        if statements:
            with engine.begin() as connection:
                for statement in statements:
                    connection.execute(text(statement))



def init_db():
    """Initialize database tables"""
    from app.db import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_schema_compatibility()
