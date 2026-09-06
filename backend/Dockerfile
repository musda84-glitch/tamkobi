FROM python:3.12-slim-bookworm

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
# Private Emergent SDK is not on PyPI; a local stub is copied below so the API can start.
RUN grep -v '^emergentintegrations==' /tmp/requirements.txt > /tmp/requirements.docker.txt \
    && pip install --no-cache-dir -r /tmp/requirements.docker.txt

COPY docker/stubs/emergentintegrations /usr/local/lib/python3.12/site-packages/emergentintegrations
COPY . /app

EXPOSE 8000

CMD ["sh", "-c", "python migrate.py && uvicorn server:app --host 0.0.0.0 --port 8000"]
