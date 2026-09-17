import json
import os
import re
from pathlib import Path
from typing import Any

import duckdb
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from groq import Groq

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
# Vercel functions have a read-only deployment bundle.  /tmp is the only
# writable location and is ephemeral, so uploaded datasets last only for the
# lifetime of the warm serverless instance.
DATA_DIR = Path(os.getenv("DATA_DIR", "/tmp/querymind-data" if os.getenv("VERCEL") else BASE_DIR / "data"))
DATA_DIR.mkdir(exist_ok=True)
DATA_FILE = DATA_DIR / "current_dataset.csv"
DB_FILE = DATA_DIR / "nova.duckdb"
META_FILE = DATA_DIR / "dataset_meta.json"
TABLE_NAME = "dataset"
DEFAULT_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
MAX_SQL_RETRIES = 3
MAX_RESULT_ROWS = 1000
ALLOWED_CHARTS = {
    "auto", "all", "bar", "horizontal_bar", "line", "area", "pie", "donut",
    "scatter", "bubble", "histogram", "box", "violin", "heatmap", "3d", "table"
}

app = FastAPI(title="QUERYMIND API", version="4.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        *[origin.strip() for origin in os.getenv("CORS_ORIGINS", "").split(",") if origin.strip()],
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    """A friendly deployment check instead of FastAPI's default 404 at `/`."""
    return {
        "service": "QUERYMIND API",
        "health": "/api/health",
        "docs": "/docs",
    }


class AnalyzeRequest(BaseModel):
    question: str
    visualization_type: str = "auto"
    include_visualizations: bool = True


def json_safe(value: Any):
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    return value


def clean_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    names = []
    used = set()
    for i, col in enumerate(df.columns):
        base = str(col).strip() or f"column_{i + 1}"
        candidate = base
        counter = 2
        while candidate.lower() in used:
            candidate = f"{base}_{counter}"
            counter += 1
        used.add(candidate.lower())
        names.append(candidate)
    df.columns = names
    return df


def save_metadata(filename: str, df: pd.DataFrame):
    META_FILE.write_text(
        json.dumps(
            {
                "filename": filename,
                "rows": int(len(df)),
                "columns": int(len(df.columns)),
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def load_df() -> pd.DataFrame | None:
    if not DATA_FILE.exists():
        return None
    try:
        return pd.read_csv(DATA_FILE)
    except Exception as exc:
        raise HTTPException(500, f"Could not read dataset: {exc}")


def connect_db():
    return duckdb.connect(str(DB_FILE))


def rebuild_duckdb(df: pd.DataFrame):
    con = connect_db()
    try:
        con.execute(f'DROP TABLE IF EXISTS "{TABLE_NAME}"')
        con.register("_upload_df", df)
        con.execute(f'CREATE TABLE "{TABLE_NAME}" AS SELECT * FROM _upload_df')
        con.unregister("_upload_df")
    finally:
        con.close()


def profile(df: pd.DataFrame):
    return [
        {
            "name": str(c),
            "dtype": str(df[c].dtype),
            "unique": int(df[c].nunique(dropna=True)),
            "nulls": int(df[c].isna().sum()),
        }
        for c in df.columns
    ]


def dataset_question_suggestions(df: pd.DataFrame):
    """Create useful, dataset-specific questions without relying on the LLM.

    The list is returned whenever a dataset is loaded, so a user can discover
    the kinds of analysis available before asking their first question.
    """
    columns = [str(column) for column in df.columns]
    numeric = [column for column in columns if pd.api.types.is_numeric_dtype(df[column])]
    categorical = [
        column for column in columns
        if column not in numeric and 1 < df[column].nunique(dropna=True) <= 50
    ]
    date_columns = [
        column for column in columns
        if re.search(r"date|time|month|year|day|week", column, re.I)
        or pd.api.types.is_datetime64_any_dtype(df[column])
    ]

    questions = [
        "How many records are in this dataset?",
        "Show the columns, data types, and missing values in this dataset.",
        "Which columns have the most missing values?",
        "Show a sample of the records in this dataset.",
    ]
    for column in numeric[:4]:
        questions.extend([
            f"What are the minimum, maximum, average, and median of {column}?",
            f"Show the distribution of {column}.",
        ])
    for column in categorical[:4]:
        questions.append(f"Show the count of records by {column}.")
        if numeric:
            questions.append(f"Show the average {numeric[0]} by {column}.")
    if date_columns and numeric:
        questions.append(f"Show the trend of {numeric[0]} over {date_columns[0]}.")
    if len(numeric) >= 2:
        questions.append(f"What is the relationship between {numeric[0]} and {numeric[1]}?")
    if categorical and numeric:
        questions.append(f"Which {categorical[0]} values have the highest {numeric[0]}?")

    # Preserve order while avoiding duplicate prompts from similarly named columns.
    return list(dict.fromkeys(questions))[:24]


def duckdb_schema():
    if not DB_FILE.exists():
        return []
    con = connect_db()
    try:
        rows = con.execute(f'DESCRIBE "{TABLE_NAME}"').fetchall()
        return [{"name": r[0], "type": r[1]} for r in rows]
    finally:
        con.close()


def schema_text():
    return "\n".join(f'- "{x["name"]}" ({x["type"]})' for x in duckdb_schema())


def sample_text(df: pd.DataFrame):
    return json.dumps(df.head(8).to_dict(orient="records"), default=str)


def analysis_request_hint(question: str, df: pd.DataFrame | None = None):
    """Return whether a prompt clearly asks for an analysis of the loaded data.

    This is deliberately local and conservative.  It prevents useful short
    questions such as "what is the mean?" from being mistaken for general
    knowledge merely because the user did not repeat a column name.
    """
    normalized = re.sub(r"\s+", " ", question.strip().lower())
    analysis_terms = (
        "dataset", "data", "table", "row", "record", "column", "field",
        "mean", "average", "median", "mode", "sum", "total", "count",
        "minimum", "maximum", "min ", "max ", "standard deviation", "variance",
        "percent", "percentage", "ratio", "rate", "growth", "change",
        "difference", "calculate", "calculation", "formula", "multiply",
        "divide", "add", "subtract", "highest", "lowest", "top ", "bottom ",
        "rank", "compare", "comparison", "distribution", "frequency",
        "correlation", "relationship", "trend", "over time", "group by",
        "missing", "null", "duplicate", "outlier", "filter", "where ",
    )
    if any(term in normalized for term in analysis_terms):
        return True
    if df is not None:
        # Match both `order_total` and natural-language `order total`.
        columns = [str(column).lower() for column in df.columns]
        normalized_columns = [column.replace("_", " ").replace("-", " ") for column in columns]
        if any(column and column in normalized for column in columns + normalized_columns):
            return True
    return False


def groq_client():
    key = os.getenv("GROQ_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GROQ_API_KEY is missing. Add it to backend/.env.")
    return Groq(api_key=key)


def extract_json(text: str):
    cleaned = str(text).strip()
    try:
        return json.loads(cleaned)
    except Exception:
        match = re.search(r"\{.*\}", cleaned, re.S)
        if not match:
            raise ValueError("Groq did not return valid JSON.")
        return json.loads(match.group(0))


def ask_groq(messages, temperature=0):
    client = groq_client()
    response = client.chat.completions.create(
        model=DEFAULT_MODEL,
        messages=messages,
        temperature=temperature,
        max_completion_tokens=4096,
        response_format={"type": "json_object"},
    )
    return response.choices[0].message.content or ""


def validate_sql(sql: str):
    sql = str(sql).strip()
    sql = re.sub(r"^```(?:sql)?", "", sql, flags=re.I).strip()
    sql = re.sub(r"```$", "", sql).strip()
    if not re.match(r"^(SELECT|WITH)\b", sql, flags=re.I):
        raise ValueError("Only SELECT/WITH analytical SQL is allowed.")
    forbidden = re.compile(
        r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|COPY|EXPORT|IMPORT|INSTALL|LOAD|CALL|PRAGMA|SET|RESET|TRUNCATE|REPLACE)\b",
        re.I,
    )
    if forbidden.search(sql):
        raise ValueError("The generated SQL contains a blocked statement.")
    if ";" in sql.rstrip(";"):
        raise ValueError("Only one SQL statement is allowed.")
    if len(sql) > 12000:
        raise ValueError("Generated SQL is too long.")
    return sql.rstrip(";").strip()


def normalize_chart_type(value: str):
    value = (value or "auto").strip().lower().replace(" ", "_")
    aliases = {
        "horizontalbar": "horizontal_bar",
        "bar_horizontal": "horizontal_bar",
        "3dscatter": "3d",
        "scatter3d": "3d",
        "all_compatible": "all",
    }
    value = aliases.get(value, value)
    return value if value in ALLOWED_CHARTS else "auto"


def generate_sql(question: str, df: pd.DataFrame, requested_chart: str):
    chart = normalize_chart_type(requested_chart)
    chart_rules = {
        "bar": "Return grouped categorical + numeric columns suitable for a bar chart.",
        "horizontal_bar": "Return grouped categorical + numeric columns suitable for a horizontal bar chart.",
        "line": "Prefer a date/time/order column plus one numeric measure, grouped chronologically if appropriate.",
        "area": "Prefer a date/time/order column plus one numeric measure, grouped chronologically if appropriate.",
        "pie": "Return one categorical dimension and one numeric measure with a small number of groups.",
        "donut": "Return one categorical dimension and one numeric measure with a small number of groups.",
        "scatter": "Return at least two numeric columns with row-level observations; do not aggregate away the relationship.",
        "bubble": "Return at least three numeric columns with row-level observations: x, y, and size.",
        "histogram": "Return one numeric column with row-level observations; up to 1000 rows is enough.",
        "box": "Return one numeric column and optionally a categorical grouping column with row-level observations.",
        "violin": "Return one numeric column and optionally a categorical grouping column with row-level observations.",
        "heatmap": "Return at least two numeric columns with row-level observations when possible.",
        "3d": "Return at least three numeric columns with row-level observations for a 3D scatter.",
        "table": "Return the most relevant columns and up to 1000 rows.",
        "all": "Return a compact but useful result set that preserves enough categorical and numeric columns to support multiple chart types.",
        "auto": "Choose the most appropriate query shape for the question.",
    }
    prompt = f"""
You are QUERYMIND, an expert data analyst using DuckDB.
Generate ONE read-only SQL query that answers the user's question using ONLY the table "dataset".
The query MUST start with SELECT or WITH. Never invent columns.
Quote column names with double quotes when needed.
Use DuckDB SQL syntax.
Return ONLY JSON with exactly these keys: sql, chart_hint.
chart_hint must be one of: bar, horizontal_bar, line, area, pie, donut, scatter, bubble, histogram, box, violin, heatmap, 3d, table, auto.
Requested visualization type: {chart}
Visualization guidance: {chart_rules[chart]}
Limit raw/detail queries to at most 1000 rows.
For aggregate queries, add an ORDER BY when useful.

You must handle the full range of data-analysis questions, including:
- descriptive statistics (count, sum, mean/average, median, mode, min/max,
  variance and standard deviation);
- arithmetic, ratios, percentages, shares, changes, growth rates and conditional
  calculations;
- filters, comparisons, grouping, ranking, top/bottom N, duplicates and missing
  values;
- distributions, correlations, relationships, trends and date/time grouping.
Use DuckDB functions such as AVG, MEDIAN, MODE, STDDEV_SAMP, COUNT_IF,
NULLIF, DATE_TRUNC, LAG and window functions where appropriate.  Return the
actual computed value(s), not an explanation of how to calculate them.  If the
question omits a column but several choices exist, return a compact result for
the relevant numeric columns or use the most clearly implied column from the
schema/sample.  Preserve NULLs unless the requested calculation requires
excluding them.

TABLE SCHEMA:
{schema_text()}

SAMPLE ROWS:
{sample_text(df)}

USER QUESTION:
{question}
"""
    raw = ask_groq([
        {"role": "system", "content": "Return strict JSON only."},
        {"role": "user", "content": prompt},
    ])
    obj = extract_json(raw)
    sql = validate_sql(obj.get("sql", ""))
    hint = normalize_chart_type(obj.get("chart_hint", chart))
    if hint == "all":
        hint = "auto"
    return sql, hint


def correct_sql(question: str, bad_sql: str, error: str, df: pd.DataFrame, requested_chart: str):
    chart = normalize_chart_type(requested_chart)
    prompt = f"""
Repair the following invalid DuckDB SQL.
Return ONLY JSON with keys sql and chart_hint.
The corrected query must be ONE read-only SELECT/WITH statement against the table "dataset".
Do not invent columns. Keep the user's requested visualization intent when possible.
Return computed dataset values for calculations and statistics; do not answer
with prose. Use DuckDB-compatible functions only.
Requested visualization: {chart}

SCHEMA:
{schema_text()}

QUESTION:
{question}

PREVIOUS SQL:
{bad_sql}

DUCKDB ERROR:
{error}
"""
    raw = ask_groq([
        {"role": "system", "content": "Repair SQL and return strict JSON only."},
        {"role": "user", "content": prompt},
    ])
    obj = extract_json(raw)
    sql = validate_sql(obj.get("sql", ""))
    hint = normalize_chart_type(obj.get("chart_hint", chart))
    return sql, hint


def is_full_dataset_request(question: str):
    """Identify requests that explicitly ask to inspect every dataset record."""
    normalized = re.sub(r"\s+", " ", question.lower()).strip()
    return bool(re.search(
        r"\b(?:show|display|view|list|give me|see)\b.*\b(?:entire|whole|full|all)\b.*\b(?:dataset|data|records?|rows?|contents?)\b"
        r"|\b(?:entire|whole|full)\s+(?:dataset|data|contents?)\b"
        r"|\b(?:all|every)\s+(?:dataset\s+)?(?:records?|rows?)\b",
        normalized,
    ))


def execute_sql_with_retry(question: str, df: pd.DataFrame, requested_chart: str):
    # A full-dataset request should not depend on the model choosing a row limit.
    # It deliberately returns every column and record from the uploaded table.
    if is_full_dataset_request(question):
        sql, hint = 'SELECT * FROM "dataset"', "table"
    else:
        sql, hint = generate_sql(question, df, requested_chart)
    errors = []
    executed_sql = []
    con = connect_db()
    try:
        for attempt in range(1, MAX_SQL_RETRIES + 1):
            try:
                executed_sql.append(sql)
                result_df = con.execute(sql).fetchdf()
                return sql, hint, result_df, attempt, errors, executed_sql
            except Exception as exc:
                error = str(exc)
                errors.append(error)
                if attempt >= MAX_SQL_RETRIES:
                    raise RuntimeError(
                        f"SQL failed after {MAX_SQL_RETRIES} attempts: {error}"
                    )
                sql, hint = correct_sql(question, sql, error, df, requested_chart)
    finally:
        con.close()


def result_records(df: pd.DataFrame, limit: int | None = MAX_RESULT_ROWS):
    if limit is not None:
        df = df.head(limit)
    return [
        {str(k): json_safe(v) for k, v in row.items()}
        for row in df.to_dict(orient="records")
    ]


def result_columns(df: pd.DataFrame):
    return [{"name": str(c), "dtype": str(df[c].dtype)} for c in df.columns]


def ai_insight(question: str, sql: str, result_df: pd.DataFrame):
    try:
        prompt = f"""
You are a professional data analyst.
The SQL below was successfully executed in DuckDB.
Explain the actual result for the user's question without inventing facts.
Return ONLY JSON:
{{"answer":"2-4 concise sentences","insight":"one useful insight","suggested_questions":["q1","q2","q3"]}}

QUESTION:
{question}

EXECUTED SQL:
{sql}

RESULT COLUMNS:
{json.dumps(result_columns(result_df))}

RESULT ROWS:
{json.dumps(result_records(result_df)[:50], default=str)}
"""
        raw = ask_groq([
            {"role": "system", "content": "Return strict JSON only."},
            {"role": "user", "content": prompt},
        ])
        obj = extract_json(raw)
        return {
            "answer": str(obj.get("answer", "Analysis completed from the executed query.")),
            "insight": str(obj.get("insight", "The insight was generated from the executed query result.")),
            "suggested_questions": [str(x) for x in obj.get("suggested_questions", [])][:3],
        }
    except Exception as exc:
        return {
            "answer": f"The query executed successfully and returned {len(result_df):,} rows.",
            "insight": f"AI insight unavailable: {exc}",
            "suggested_questions": [
                "Show the top results",
                "Compare the main categories",
                "Show a trend",
            ],
        }


def general_answer(question: str):
    prompt = f"""
You are QUERYMIND, an autonomous data intelligence assistant.
Answer the user's general question clearly and helpfully. No dataset is attached, so do not claim to have analysed private data or verified live information. Be concise and use plain language.
Return ONLY JSON with these keys:
{{"answer":"a helpful answer in 2-5 short paragraphs","suggested_questions":["q1","q2","q3"]}}

USER QUESTION:
{question}
"""
    raw = ask_groq([
        {"role": "system", "content": "Return strict JSON only."},
        {"role": "user", "content": prompt},
    ], temperature=0.3)
    obj = extract_json(raw)
    return {
        "answer": str(obj.get("answer", "I couldn't generate an answer for that question.")),
        "suggested_questions": [str(x) for x in obj.get("suggested_questions", [])][:3],
    }


def is_general_question(question: str, df=None):
    """Route definition/explanation questions away from a previously loaded dataset."""
    normalized = re.sub(r"\s+", " ", question.strip().lower())
    general_openers = (
        "what is ", "what are ", "who is ", "who are ", "define ",
        "explain ", "tell me about ", "how does ", "how do ",
    )
    if not normalized.startswith(general_openers):
        return False

    # A question can be a data question without naming a field: for example,
    # "What is the mean?" or "What percentage is missing?".
    return not analysis_request_hint(normalized, df)


def is_dataset_question(question: str, df: pd.DataFrame):
    """Use the model to keep QUERYMIND within the uploaded dataset's scope."""
    if is_general_question(question, df):
        return False
    prompt = f"""
Decide whether the user's question can be answered by analysing the uploaded dataset.
Return ONLY JSON: {{"related": true}} or {{"related": false}}.
Mark related true only when the question asks about records, values, patterns, summaries, comparisons, trends, or columns in this dataset. Mark false for general knowledge, coding help, opinions, or subjects not represented in the dataset.

DATASET COLUMNS:
{schema_text()}

SAMPLE ROWS:
{sample_text(df)}

USER QUESTION:
{question}
"""
    raw = ask_groq([
        {"role": "system", "content": "Return strict JSON only."},
        {"role": "user", "content": prompt},
    ])
    return bool(extract_json(raw).get("related", False))


def dataset_only_response(question: str):
    return {
        "question": question,
        "answer": "I can only answer questions about the uploaded dataset. Please ask about its columns, values, trends, comparisons, or records.",
        "general": True,
        "suggested_questions": [],
        "metrics": [],
    }


def read_uploaded_dataset(path: Path, ext: str):
    """Import common structured-data files, with delimited-text detection as a fallback."""
    if ext in {".xlsx", ".xls", ".xlsm", ".xlsb", ".ods"}:
        engines = {".xlsx": "openpyxl", ".xlsm": "openpyxl", ".xls": "xlrd", ".ods": "odf"}
        return pd.read_excel(path, engine=engines.get(ext))

    if ext in {".json", ".jsonl", ".ndjson"}:
        try:
            return pd.read_json(path, lines=ext in {".jsonl", ".ndjson"})
        except ValueError:
            return pd.read_json(path, lines=True)

    if ext in {".parquet", ".pq"}:
        con = duckdb.connect()
        try:
            return con.execute("SELECT * FROM read_parquet(?)", [str(path)]).fetchdf()
        finally:
            con.close()

    if ext == ".xml":
        return pd.read_xml(path)

    # CSV, TSV, TXT and unfamiliar text extensions are auto-detected here.
    return pd.read_csv(path, sep=None, engine="python")


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "dataset_loaded": DATA_FILE.exists(),
        "duckdb_ready": DB_FILE.exists(),
        "groq_configured": bool(os.getenv("GROQ_API_KEY", "").strip()),
        "groq_model": DEFAULT_MODEL,
    }


@app.get("/api/dataset")
def dataset_info():
    df = load_df()
    if df is None:
        return {"loaded": False}
    filename = "current_dataset.csv"
    if META_FILE.exists():
        try:
            filename = json.loads(META_FILE.read_text(encoding="utf-8")).get("filename", filename)
        except Exception:
            pass
    return {
        "loaded": True,
        "filename": filename,
        "rows": len(df),
        "columns": len(df.columns),
        "column_names": list(df.columns),
        "profile": profile(df),
        "dataset_questions": dataset_question_suggestions(df),
        "duckdb": {"database": "data/nova.duckdb", "table": TABLE_NAME, "schema": duckdb_schema()},
    }


@app.delete("/api/dataset")
def remove_dataset():
    """Remove the persisted upload and its local DuckDB copy."""
    for path in (DATA_FILE, DB_FILE, META_FILE):
        path.unlink(missing_ok=True)
    return {"removed": True}


@app.post("/api/upload")
async def upload_dataset(file: UploadFile = File(...)):
    name = file.filename or ""
    ext = Path(name).suffix.lower()
    raw = await file.read()
    temp = DATA_DIR / f"upload{ext or '.data'}"
    temp.write_bytes(raw)
    try:
        df = read_uploaded_dataset(temp, ext)
        df = clean_columns(df)
        if df.empty or len(df.columns) == 0:
            raise ValueError("The uploaded file contains no usable data.")
        df.to_csv(DATA_FILE, index=False)
        rebuild_duckdb(df)
        save_metadata(name, df)
    except Exception as exc:
        temp.unlink(missing_ok=True)
        raise HTTPException(400, f"Could not turn this file into a table: {exc}")
    temp.unlink(missing_ok=True)
    return {
        "loaded": True,
        "filename": name,
        "rows": len(df),
        "columns": len(df.columns),
        "column_names": list(df.columns),
        "profile": profile(df),
        "dataset_questions": dataset_question_suggestions(df),
        "duckdb": {"database": "data/nova.duckdb", "table": TABLE_NAME, "schema": duckdb_schema()},
    }


@app.post("/api/analyze")
def analyze(payload: AnalyzeRequest):
    question = payload.question.strip()
    chart_type = normalize_chart_type(payload.visualization_type if payload.include_visualizations else "table")
    if not question:
        raise HTTPException(400, "Question cannot be empty.")

    df = load_df()
    if df is None or not DB_FILE.exists():
        return dataset_only_response(question)

    # Let the SQL analyst handle every normal question about the uploaded data.
    # Only obvious knowledge/explanation prompts are kept outside dataset analysis.
    if is_general_question(question, df):
        return dataset_only_response(question)

    full_dataset = is_full_dataset_request(question)

    try:
        sql, hint, result_df, attempts, errors, executed_sql = execute_sql_with_retry(question, df, chart_type)
    except Exception as exc:
        raise HTTPException(422, str(exc))

    ai = ai_insight(question, sql, result_df)

    metrics = []
    for col in result_df.select_dtypes(include="number").columns[:4]:
        series = result_df[col].dropna()
        if len(series):
            metrics.append({
                "label": str(col),
                "value": float(series.sum()),
                "description": f"Sum across {len(series):,} returned rows",
            })

    records = result_records(result_df, limit=None if full_dataset else MAX_RESULT_ROWS)

    return {
        "question": question,
        "answer": ai["answer"],
        "general": False,
        "visualizations_enabled": payload.include_visualizations,
        "insight": ai["insight"],
        "sql": sql,
        "executed_sql": executed_sql,
        "sql_attempts": attempts,
        "sql_repaired": attempts > 1,
        "sql_errors": errors,
        "chart_hint": hint,
        "requested_visualization": chart_type,
        "metrics": metrics,
        # Visuals are intentionally built in the React UI from this exact query result
        # so the user can switch between chart types without changing the dataset result.
        "visualizations": [],
        "query_result": {
            "columns": result_columns(result_df),
            "rows": records,
            "row_count": int(len(result_df)),
            "truncated": not full_dataset and len(result_df) > MAX_RESULT_ROWS,
            "full_dataset": full_dataset,
        },
        "dataset": {
            "rows": len(df),
            "columns": len(df.columns),
            "schema": duckdb_schema(),
        },
        "suggested_questions": ai["suggested_questions"],
    }
