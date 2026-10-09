ARG PYTHON_BASE=public.ecr.aws/docker/library/python@sha256:05cda9777409a9c3ffddd94a4c476b79f0769a0b4857f0c7ed9226b6800b0d6f
FROM ${PYTHON_BASE}
USER 0:0
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MPLCONFIGDIR=/tmp/matplotlib OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --only-binary=:all: -r requirements.txt
COPY analyze.py /app/analyze.py
USER 65534:65534
ENTRYPOINT ["python3", "-I", "/app/analyze.py"]
