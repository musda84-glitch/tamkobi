FROM python:3.12-slim-bookworm

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/log/tamkobi \
    && chmod 777 /var/log/tamkobi

COPY requirements.txt /tmp/requirements.txt
# Skip the PyPI namesake (malware / unpublished). Core REST+MySQL runs with the stub.
# AI/billing call sites import emergentintegrations; drop a real wheel in
# docker/stubs to replace this without changing application imports.
RUN grep -vE '^(#|emergentintegrations==)' /tmp/requirements.txt > /tmp/requirements.docker.txt \
    && pip install --no-cache-dir -r /tmp/requirements.docker.txt

COPY docker/stubs/emergentintegrations /usr/local/lib/python3.12/site-packages/emergentintegrations
COPY . /app
ARG GIT_SHA=
ARG GIT_BRANCH=
ARG GIT_MESSAGE=
ARG BUILD_TIME=
ENV APP_GIT_SHA=$GIT_SHA \
    APP_GIT_BRANCH=$GIT_BRANCH \
    APP_GIT_MESSAGE="$GIT_MESSAGE" \
    APP_BUILD_TIME=$BUILD_TIME
RUN chmod +x /app/scripts/rotate-logs.sh /app/scripts/perf-monitor.sh /app/scripts/apply-mysql-tuning.sh /app/scripts/map_schema.py

EXPOSE 8000

CMD ["sh", "-c", "python migrate.py && uvicorn server:app --host 0.0.0.0 --port 8000"]
