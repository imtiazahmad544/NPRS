FROM python:3.12-slim
WORKDIR /srv
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt psycopg2-binary
COPY backend ./backend
COPY frontend ./frontend
COPY edge ./edge
ENV PYTHONPATH=/srv/backend NPRS_FRONTEND_DIR=/srv/frontend
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
