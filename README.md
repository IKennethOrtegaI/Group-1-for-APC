# AI-Based Intrusion Detection System for Enterprise Networks

**Group 1 — APC**

## Stack
- **Backend**: FastAPI + SQLAlchemy + SQLite
- **ML Models**: Random Forest + XGBoost (scikit-learn)
- **Datasets**: NSL-KDD, CICIDS2017
- **Frontend**: React + Tailwind CSS + Recharts
- **Deploy**: Docker Compose

## Quick Start

### 1. Place datasets
```
backend/data/raw/KDDTrain+.txt
backend/data/raw/KDDTest+.txt
backend/data/raw/Friday-WorkingHours-Afternoon-DDos.pcap_ISCX.csv
```

### 2. Run with Docker
```bash
docker-compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

### 3. Run locally (development)

**Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## Usage

1. **Train** — Go to Train tab, select dataset + model, click Start Training
2. **Compare** — Overview tab shows RF vs XGBoost metrics side by side
3. **Predict** — Predict tab: enter features manually or load sample data
4. **Batch** — Upload a CSV file to analyze hundreds of records at once

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /models/train | Start training (async) |
| GET | /models/train/status/{dataset}/{model} | Poll training status |
| POST | /models/predict | Single prediction |
| GET | /models/metrics/{dataset}/{model} | Latest metrics |
| GET | /models/compare/{dataset} | RF vs XGBoost comparison |
| GET | /alerts/ | Recent predictions history |
| GET | /alerts/stats | Attack/Normal counts |
| POST | /alerts/upload-csv | Batch prediction from CSV |
| GET | /docs | Interactive API documentation |
