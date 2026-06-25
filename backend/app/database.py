from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from backend.app.config import settings

# Determine database engine settings
db_url = settings.DATABASE_URL
connect_args = {}

# SQLite requires different arguments to handle concurrent threads safely
if db_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(
    db_url, connect_args=connect_args
)

# Enable foreign keys for SQLite databases specifically
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    if db_url.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Dependency for FastAPI endpoints to get a clean database session per request
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
