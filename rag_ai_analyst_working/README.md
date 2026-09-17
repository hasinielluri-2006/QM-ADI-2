# Querymind — Autonomous Data Intelligence

A local React + FastAPI data analyst that accepts **CSV, XLSX and XLS**, automatically creates a **DuckDB** database, uses **Groq** to understand natural-language questions, generates and executes SQL, repairs invalid SQL, returns the real query result, creates Plotly visualizations, and generates an AI insight.

## Features

- CSV / XLSX / XLS upload
- Automatic column and data-type inspection
- Automatic local DuckDB database: `backend/data/nova.duckdb`
- Natural-language question understanding with Groq
- SQL generation against the uploaded `dataset` table
- Read-only SQL validation for safety
- Automatic SQL correction/retry (up to 3 attempts)
- Actual executed SQL shown in the React UI
- Actual SQL result rows returned to the UI
- Bar, line, pie and scatter charts
- 3D Plotly visualization when appropriate
- AI answer + insight + suggested follow-up questions
- Existing Querymind React interface preserved and extended

## 1. Configure Groq

Create `backend/.env` from `.env.example`:

```env
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-120b
```

Do **not** put the key in React.

The default model is configurable through `GROQ_MODEL`.

## 2. Start backend

Windows:

```bash
cd backend
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Check:

`http://127.0.0.1:8000/api/health`

## 3. Start frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## 4. Use it

1. Upload a `.csv`, `.xlsx`, or `.xls` file.
2. The backend profiles the columns and rebuilds `backend/data/nova.duckdb`.
3. Ask a question such as:
   - `Show total sales by region`
   - `What are the top 10 products by revenue?`
   - `Show the monthly revenue trend`
   - `Find the relationship between price and sales`
   - `Give me a 3D visualization of the numeric columns`
4. Groq generates SQL using the real DuckDB schema.
5. DuckDB executes it.
6. If SQL fails, Nova sends the error back to Groq and repairs the query automatically.
7. The UI displays the executed SQL, actual query result, visualizations, and AI insight.

## SQL safety

Only a single `SELECT` or `WITH` statement is accepted. Write operations such as INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, ATTACH, COPY, INSTALL and PRAGMA are blocked.

## Project structure

```text
rag_ai_analyst_working/
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       └── styles.css
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   ├── .env.example
│   └── data/                 # created automatically
│       └── nova.duckdb       # created after upload
└── README.md
```
