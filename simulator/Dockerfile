FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY stb_simulator ./stb_simulator
RUN useradd --create-home --uid 1001 sim
USER sim
EXPOSE 8100
CMD ["python", "-m", "stb_simulator.main"]
