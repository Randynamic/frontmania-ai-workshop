# Verified 26 Sep 2026: ghcr.io/mlflow/mlflow:v3.16.1 does not ship psycopg2
# (docker run --rm ghcr.io/mlflow/mlflow:v3.16.1 python -c "import psycopg2" -> ModuleNotFoundError).
# The Postgres backend store needs it; OTel trace ingestion needs a SQL store.
FROM ghcr.io/mlflow/mlflow:v3.16.1
RUN pip install --no-cache-dir psycopg2-binary==2.9.10
