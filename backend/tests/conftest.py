import os
from pathlib import Path

os.environ["DATABASE_URL"] = f"sqlite:///{Path(__file__).parent / 'cronobalance-test.db'}"
os.environ["APP_ENV"] = "development"
os.environ["DEV_AUTH_TOKEN"] = "test-local-token"
os.environ["AUTO_CREATE_SCHEMA"] = "true"
os.environ["CORS_ORIGINS"] = "http://testserver"

import pytest
from fastapi.testclient import TestClient
from app.db.session import Base, engine
from app.main import app


@pytest.fixture
def client():
    Base.metadata.drop_all(bind=engine)
    with TestClient(app) as test_client:
        yield test_client
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def auth_headers():
    return {"Authorization": "Bearer test-local-token"}
