import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import Plot from "react-plotly.js";
import {
  BarChart3,
  Database,
  History,
  Plus,
  Search,
  Settings,
  Sparkles,
  ArrowUpRight,
  Download,
  Maximize2,
  ChevronDown,
  Send,
  LayoutDashboard,
  Activity,
  Upload,
  FileSpreadsheet,
  X,
  LineChart,
  PieChart,
  CircleDot,
  Grid3X3,
  Cuboid,
  Table2,
  BrainCircuit,
  Trash2,
} from "lucide-react";

// Set VITE_API_URL to the deployed backend URL (without a trailing slash).
// The local address remains the default for development.
const API = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const CHART_COLORS = ["#22d3ee", "#8b5cf6", "#4ade80", "#f59e0b", "#fb7185", "#60a5fa", "#e879f9", "#facc15"];

const VISUAL_OPTIONS = [
  { key: "auto", label: "Auto", icon: Sparkles },
  { key: "all", label: "All compatible", icon: LayoutDashboard },
  { key: "bar", label: "Bar", icon: BarChart3 },
  { key: "horizontal_bar", label: "Horizontal bar", icon: BarChart3 },
  { key: "line", label: "Line", icon: LineChart },
  { key: "area", label: "Area", icon: Activity },
  { key: "pie", label: "Pie", icon: PieChart },
  { key: "donut", label: "Donut", icon: CircleDot },
  { key: "scatter", label: "Scatter", icon: CircleDot },
  { key: "bubble", label: "Bubble", icon: CircleDot },
  { key: "histogram", label: "Histogram", icon: BarChart3 },
  { key: "box", label: "Box", icon: BarChart3 },
  { key: "violin", label: "Violin", icon: Activity },
  { key: "heatmap", label: "Heatmap", icon: Grid3X3 },
  { key: "3d", label: "3D", icon: Cuboid },
  { key: "table", label: "Table", icon: Table2 },
];

function Sidebar({ onNew, onSettings, onHistory, activeSection, onNavigate }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><BrainCircuit size={19} strokeWidth={2.25} /></div>
        <div><strong>QUERYMIND</strong><span>Autonomous Data Intelligence</span></div>
      </div>

      <button className="new-analysis" type="button" onClick={onNew}>
        <Plus size={17} /> New analysis
      </button>

      <div className="side-section">
        <p>WORKSPACE</p>
        <button className={`side-link settings-link ${activeSection === "overview" ? "active" : ""}`} type="button" onClick={() => onNavigate("overview")}><LayoutDashboard size={17} /> Overview</button>
        <button className={`side-link settings-link ${activeSection === "sources" ? "active" : ""}`} type="button" onClick={() => onNavigate("sources")}><Database size={17} /> Data sources</button>
        <button className={`side-link settings-link ${activeSection === "visualizations" ? "active" : ""}`} type="button" onClick={() => onNavigate("visualizations")}><BarChart3 size={17} /> Visualizations</button>
      </div>

      <div className="side-section">
        <p>RECENT</p>
        <button className="side-link settings-link" type="button" onClick={onHistory}><History size={17} /> Analysis history</button>
      </div>

      <div className="sidebar-bottom">
        <div className="connection"><span></span> Backend ready</div>
        <button className="side-link settings-link" type="button" onClick={onSettings}><Settings size={17} /> Settings</button>
      </div>
    </aside>
  );
}

function Topbar({ dataset, onSearch, onExport }) {
  return (
    <header className="topbar">
      <div>
        <div className="eyebrow">AUTONOMOUS DATA INTELLIGENCE</div>
        <h1>{dataset?.filename || "Your data workspace"}</h1>
      </div>
      <div className="top-actions">
        <button className="ghost-btn" type="button" onClick={onSearch}><Search size={16} /> Search</button>
        <button className="ghost-btn" type="button" onClick={onExport}><Download size={16} /> Export</button>
        <div className="avatar">AI</div>
      </div>
    </header>
  );
}

function Metric({ item, index }) {
  return (
    <motion.div
      className="metric-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <div className="metric-top">
        <span>{item.label}</span>
        <ArrowUpRight size={17} />
      </div>
      <div className="metric-value">
        {typeof item.value === "number"
          ? item.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
          : String(item.value ?? "—")}
      </div>
      <div className="metric-foot">{item.description || "Calculated from query result"}</div>
    </motion.div>
  );
}

function Card({ title, children, subtitle = "Generated from the query result" }) {
  return (
    <section className="chart-card">
      <div className="card-head">
        <div>
          <div className="card-title">{title}</div>
          <div className="card-sub">{subtitle}</div>
        </div>
        <button type="button" className="icon-button" aria-label="Expand chart">
          <Maximize2 size={15} />
        </button>
      </div>
      {children}
    </section>
  );
}

function normalizeRows(result) {
  if (!result) return [];
  return Array.isArray(result.rows) ? result.rows : [];
}

function normalizeColumns(result, rows) {
  if (Array.isArray(result?.columns) && result.columns.length) {
    return result.columns.map((column) =>
      typeof column === "object" ? column.name : String(column)
    );
  }
  if (rows.length && typeof rows[0] === "object" && rows[0] !== null) {
    return Object.keys(rows[0]);
  }
  return [];
}

function isNumber(value) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

function isDateLike(value) {
  if (value === null || value === undefined || value === "") return false;
  const text = String(value);
  if (!/[\-/]/.test(text)) return false;
  const date = new Date(text);
  return !Number.isNaN(date.getTime());
}

function analyzeShape(result) {
  const rows = normalizeRows(result);
  const columns = normalizeColumns(result, rows);

  const numericColumns = columns.filter((column) =>
    rows.some((row) => isNumber(row?.[column]))
  );

  const categoricalColumns = columns.filter(
    (column) => !numericColumns.includes(column)
  );

  const dateColumns = columns.filter((column) =>
    rows.some((row) => isDateLike(row?.[column]))
  );

  return {
    rows,
    columns,
    numericColumns,
    categoricalColumns,
    dateColumns,
  };
}

function aggregateCategory(rows, category, value) {
  const map = new Map();

  rows.forEach((row) => {
    const categoryValue = row?.[category];
    const numericValue = Number(row?.[value]);

    if (categoryValue === null || categoryValue === undefined) return;
    if (!Number.isFinite(numericValue)) return;

    const key = String(categoryValue);
    map.set(key, (map.get(key) || 0) + numericValue);
  });

  return Array.from(map.entries())
    .map(([x, y]) => ({ x, y }))
    .sort((a, b) => b.y - a.y)
    .slice(0, 20);
}

function makeChartSpecs(result) {
  const { rows, columns, numericColumns, categoricalColumns, dateColumns } =
    analyzeShape(result);

  const specs = [];

  const category = categoricalColumns[0];
  const secondCategory = categoricalColumns[1];
  const numeric = numericColumns[0];
  const secondNumeric = numericColumns[1];
  const thirdNumeric = numericColumns[2];
  const dateColumn = dateColumns[0];

  if (category && numeric) {
    const grouped = aggregateCategory(rows, category, numeric);

    if (grouped.length) {
      specs.push({
        key: "bar",
        label: "Bar",
        title: `${numeric} by ${category}`,
        type: "bar",
        x: grouped.map((item) => item.x),
        y: grouped.map((item) => item.y),
      });

      specs.push({
        key: "horizontal_bar",
        label: "Horizontal bar",
        title: `${numeric} by ${category}`,
        type: "horizontal_bar",
        x: grouped.map((item) => item.x),
        y: grouped.map((item) => item.y),
      });

      if (grouped.length <= 12) {
        specs.push({
          key: "pie",
          label: "Pie",
          title: `${category} contribution`,
          type: "pie",
          labels: grouped.map((item) => item.x),
          values: grouped.map((item) => item.y),
        });

        specs.push({
          key: "donut",
          label: "Donut",
          title: `${category} contribution`,
          type: "donut",
          labels: grouped.map((item) => item.x),
          values: grouped.map((item) => item.y),
        });
      }
    }
  }

  if (numeric && (dateColumn || category)) {
    const xColumn = dateColumn || category;
    const trendRows = rows
      .filter((row) => row?.[xColumn] !== null && isNumber(row?.[numeric]))
      .map((row) => ({
        x: String(row[xColumn]),
        y: Number(row[numeric]),
        sort: dateColumn ? new Date(row[xColumn]).getTime() : 0,
      }))
      .sort((a, b) => {
        if (dateColumn && Number.isFinite(a.sort) && Number.isFinite(b.sort)) {
          return a.sort - b.sort;
        }
        return 0;
      })
      .slice(0, 250);

    if (trendRows.length >= 2) {
      specs.push({
        key: "line",
        label: "Line",
        title: `${numeric} trend by ${xColumn}`,
        type: "line",
        x: trendRows.map((item) => item.x),
        y: trendRows.map((item) => item.y),
      });

      specs.push({
        key: "area",
        label: "Area",
        title: `${numeric} area trend`,
        type: "area",
        x: trendRows.map((item) => item.x),
        y: trendRows.map((item) => item.y),
      });
    }
  }

  if (numeric && secondNumeric) {
    const scatterRows = rows
      .filter((row) => isNumber(row?.[numeric]) && isNumber(row?.[secondNumeric]))
      .slice(0, 1500);

    if (scatterRows.length >= 2) {
      specs.push({
        key: "scatter",
        label: "Scatter",
        title: `${numeric} vs ${secondNumeric}`,
        type: "scatter",
        x: scatterRows.map((row) => Number(row[numeric])),
        y: scatterRows.map((row) => Number(row[secondNumeric])),
        xLabel: numeric,
        yLabel: secondNumeric,
      });
    }

    if (thirdNumeric) {
      const bubbleRows = rows
        .filter(
          (row) =>
            isNumber(row?.[numeric]) &&
            isNumber(row?.[secondNumeric]) &&
            isNumber(row?.[thirdNumeric])
        )
        .slice(0, 1200);

      if (bubbleRows.length >= 2) {
        specs.push({
          key: "bubble",
          label: "Bubble",
          title: `${numeric} vs ${secondNumeric} · size ${thirdNumeric}`,
          type: "bubble",
          x: bubbleRows.map((row) => Number(row[numeric])),
          y: bubbleRows.map((row) => Number(row[secondNumeric])),
          sizes: bubbleRows.map((row) => Math.abs(Number(row[thirdNumeric]))),
          xLabel: numeric,
          yLabel: secondNumeric,
          sizeLabel: thirdNumeric,
        });
      }
    }
  }

  if (numeric) {
    const values = rows
      .map((row) => Number(row?.[numeric]))
      .filter(Number.isFinite)
      .slice(0, 2000);

    if (values.length >= 2) {
      specs.push({
        key: "histogram",
        label: "Histogram",
        title: `Distribution of ${numeric}`,
        type: "histogram",
        values,
        xLabel: numeric,
      });

      specs.push({
        key: "box",
        label: "Box",
        title: `Box plot of ${numeric}`,
        type: "box",
        values,
        xLabel: numeric,
      });

      specs.push({
        key: "violin",
        label: "Violin",
        title: `Violin plot of ${numeric}`,
        type: "violin",
        values,
        xLabel: numeric,
      });
    }
  }

  if (numericColumns.length >= 2 && rows.length >= 2) {
    const matrix = numericColumns.map((colA) => {
      return numericColumns.map((colB) => {
        const pairs = rows
          .map((row) => [Number(row?.[colA]), Number(row?.[colB])])
          .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));

        if (pairs.length < 2) return 0;

        const xs = pairs.map((pair) => pair[0]);
        const ys = pairs.map((pair) => pair[1]);
        const mx = xs.reduce((sum, value) => sum + value, 0) / xs.length;
        const my = ys.reduce((sum, value) => sum + value, 0) / ys.length;
        const numerator = xs.reduce(
          (sum, value, index) => sum + (value - mx) * (ys[index] - my),
          0
        );
        const dx = Math.sqrt(xs.reduce((sum, value) => sum + (value - mx) ** 2, 0));
        const dy = Math.sqrt(ys.reduce((sum, value) => sum + (value - my) ** 2, 0));
        return dx && dy ? numerator / (dx * dy) : 0;
      });
    });

    specs.push({
      key: "heatmap",
      label: "Heatmap",
      title: "Numeric correlation heatmap",
      type: "heatmap",
      x: numericColumns,
      y: numericColumns,
      z: matrix,
    });
  }

  if (numericColumns.length >= 3) {
    const [a, b, c] = numericColumns;
    const points = rows
      .filter(
        (row) =>
          isNumber(row?.[a]) &&
          isNumber(row?.[b]) &&
          isNumber(row?.[c])
      )
      .slice(0, 1000)
      .map((row) => ({
        x: Number(row[a]),
        y: Number(row[b]),
        z: Number(row[c]),
      }));

    if (points.length >= 2) {
      specs.push({
        key: "3d",
        label: "3D",
        title: `${a} × ${b} × ${c}`,
        type: "3d",
        x: a,
        y: b,
        z: c,
        points,
      });
    }
  }

  specs.push({
    key: "table",
    label: "Table",
    title: "Query result",
    type: "table",
    rows,
    columns,
  });

  const deduped = [];
  const seen = new Set();
  specs.forEach((spec) => {
    if (!seen.has(spec.key)) {
      seen.add(spec.key);
      deduped.push(spec);
    }
  });

  return deduped;
}

function chartLayout(title, xTitle, yTitle) {
  return {
    autosize: true,
    height: 340,
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    margin: { l: 55, r: 18, t: 45, b: 65 },
    font: { color: "#9aa2b5" },
    title: { text: title, font: { size: 14, color: "#e7edf5" }, x: 0.02 },
    xaxis: { title: xTitle || "", gridcolor: "transparent", automargin: true },
    yaxis: { title: yTitle || "", gridcolor: "rgba(255,255,255,.06)", automargin: true },
    hovermode: "closest",
    hoverlabel: { bgcolor: "#111b2a", bordercolor: "#22d3ee", font: { color: "#edf7fb" } },
    transition: { duration: 500, easing: "cubic-in-out" },
  };
}

function PlotForSpec({ spec }) {
  if (spec.type === "table") {
    return (
      <div className="result-table-scroll visualization-table">
        <table>
          <thead>
            <tr>
              {spec.columns.map((column) => <th key={column}>{column}</th>)}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row, index) => (
              <tr key={index}>
                {spec.columns.map((column) => (
                  <td key={column}>
                    {row?.[column] === null || row?.[column] === undefined
                      ? "—"
                      : String(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  let data = [];
  let layout = chartLayout(spec.title, spec.xLabel, spec.yLabel);

  if (spec.type === "bar") {
    data = [{ type: "bar", x: spec.x, y: spec.y, marker: { color: spec.x.map((_, index) => CHART_COLORS[index % CHART_COLORS.length]), line: { color: "rgba(255,255,255,.24)", width: 1 } }, hovertemplate: `%{x}<br><b>%{y:,.2f}</b><extra></extra>` }];
  } else if (spec.type === "horizontal_bar") {
    data = [{ type: "bar", x: spec.y, y: spec.x, orientation: "h", marker: { color: spec.x.map((_, index) => CHART_COLORS[index % CHART_COLORS.length]) }, hovertemplate: `%{y}<br><b>%{x:,.2f}</b><extra></extra>` }];
  } else if (spec.type === "line") {
    data = [{ type: "scatter", mode: "lines+markers", x: spec.x, y: spec.y, line: { width: 3, color: "#22d3ee", shape: "spline" }, marker: { size: 7, color: "#a78bfa", line: { color: "#e9d5ff", width: 1 } }, hovertemplate: `%{x}<br><b>%{y:,.2f}</b><extra></extra>` }];
  } else if (spec.type === "area") {
    data = [{ type: "scatter", mode: "lines", fill: "tozeroy", x: spec.x, y: spec.y, line: { width: 2, color: "#22d3ee", shape: "spline" }, fillcolor: "rgba(34,211,238,.18)", hovertemplate: `%{x}<br><b>%{y:,.2f}</b><extra></extra>` }];
  } else if (spec.type === "pie") {
    data = [{ type: "pie", labels: spec.labels, values: spec.values, hole: 0, marker: { colors: CHART_COLORS, line: { color: "#101722", width: 2 } }, textinfo: "label+percent", textfont: { size: 10 }, hovertemplate: `%{label}<br><b>%{value:,.2f}</b> · %{percent}<extra></extra>` }];
    layout = { ...layout, showlegend: true };
  } else if (spec.type === "donut") {
    data = [{ type: "pie", labels: spec.labels, values: spec.values, hole: 0.58, marker: { colors: CHART_COLORS, line: { color: "#101722", width: 2 } }, textinfo: "percent", textfont: { size: 11 }, hovertemplate: `%{label}<br><b>%{value:,.2f}</b> · %{percent}<extra></extra>` }];
    layout = { ...layout, showlegend: true };
  } else if (spec.type === "scatter") {
    data = [{
      type: "scatter",
      mode: "markers",
      x: spec.x,
      y: spec.y,
      marker: { size: 8, opacity: 0.8, color: "#22d3ee", line: { color: "#c4b5fd", width: 1 } },
      hovertemplate: `${spec.xLabel}: %{x:,.2f}<br>${spec.yLabel}: <b>%{y:,.2f}</b><extra></extra>`,
    }];
  } else if (spec.type === "bubble") {
    const minSize = Math.min(...spec.sizes);
    const maxSize = Math.max(...spec.sizes);
    const range = maxSize - minSize || 1;
    const markerSizes = spec.sizes.map((value) => 10 + ((value - minSize) / range) * 35);

    data = [{
      type: "scatter",
      mode: "markers",
      x: spec.x,
      y: spec.y,
      marker: {
        size: markerSizes,
        opacity: 0.72, color: "#8b5cf6", line: { color: "#c4b5fd", width: 1 },
      },
    }];
  } else if (spec.type === "histogram") {
    data = [{ type: "histogram", x: spec.values, nbinsx: 24, marker: { color: "#22d3ee", line: { color: "#a5f3fc", width: 1 } }, hovertemplate: "%{x}<br><b>%{y} records</b><extra></extra>" }];
  } else if (spec.type === "box") {
    data = [{ type: "box", y: spec.values, name: spec.xLabel || "Value", boxmean: true, marker: { color: "#8b5cf6" }, line: { color: "#c4b5fd" }, boxpoints: "outliers" }];
  } else if (spec.type === "violin") {
    data = [{ type: "violin", y: spec.values, name: spec.xLabel || "Value", box: { visible: true }, meanline: { visible: true }, fillcolor: "rgba(34,211,238,.45)", line: { color: "#67e8f9" } }];
  } else if (spec.type === "heatmap") {
    data = [{
      type: "heatmap",
      z: spec.z,
      x: spec.x,
      y: spec.y,
      zmin: -1,
      zmax: 1,
      colorscale: "RdBu",
      reversescale: true,
      hovertemplate: "%{y} × %{x}<br><b>%{z:.2f}</b><extra></extra>",
    }];
  } else if (spec.type === "3d") {
    data = [{
      type: "scatter3d",
      mode: "markers",
      x: spec.points.map((point) => point.x),
      y: spec.points.map((point) => point.y),
      z: spec.points.map((point) => point.z),
      marker: {
        size: 5,
        opacity: 0.82,
      },
      hovertemplate:
        `${spec.x}: %{x}<br>${spec.y}: %{y}<br>${spec.z}: %{z}<extra></extra>`,
    }];

    layout = {
      ...layout,
      height: 440,
      margin: { l: 0, r: 0, t: 45, b: 0 },
      scene: {
        bgcolor: "transparent",
        xaxis: { title: spec.x },
        yaxis: { title: spec.y },
        zaxis: { title: spec.z },
      },
    };
  }

  return (
    <Plot
      data={data}
      layout={layout}
      config={{
        responsive: true,
        displaylogo: false,
        displayModeBar: true,
        scrollZoom: true,
        modeBarButtonsToRemove: ["lasso2d", "select2d"],
      }}
      animate
      animation={{ transition: { duration: 500, easing: "cubic-in-out" }, frame: { duration: 600, redraw: false } }}
      useResizeHandler
      style={{ width: "100%", height: spec.type === "3d" ? 440 : 340 }}
    />
  );
}

function VisualizationStudio({ result, selectedType, preferredType }) {
  const specs = useMemo(() => makeChartSpecs(result), [result]);

  const visibleSpecs = useMemo(() => {
    if (selectedType === "all") {
      return specs;
    }

    if (selectedType === "auto") {
      const preferred = specs.find((spec) => spec.key === preferredType);
      return [preferred || specs.find((spec) => spec.key !== "table") || specs[0]];
    }

    return specs.filter((spec) => spec.key === selectedType);
  }, [selectedType, specs]);

  if (!specs.length) {
    return (
      <Card>
        <div className="empty-state">
          <BarChart3 size={28} />
          <h3>No visualizations available</h3>
          <p>The query returned no chartable data.</p>
        </div>
      </Card>
    );
  }

  if (!visibleSpecs.length) {
    return (
      <Card>
        <div className="empty-state">
          <BarChart3 size={28} />
          <h3>{selectedType} is not available for this result</h3>
          <p>Choose “All compatible” to see every chart that the returned data supports.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="visual-grid">
      {visibleSpecs.map((spec, index) => (
        <Card key={`${spec.key}-${index}`} title={spec.title} subtitle="Interactive · based on actual query result">
          <PlotForSpec spec={spec} />
        </Card>
      ))}
    </div>
  );
}

function formatSqlForDisplay(sql) {
  const compact = String(sql || "").replace(/\s+/g, " ").trim();
  if (!compact) return "-- No SQL returned.";

  return compact
    .replace(/^SELECT\s+/i, "SELECT\n  ")
    .replace(/,\s*/g, ",\n  ")
    .replace(/\s+(FROM|WHERE|HAVING|LIMIT|OFFSET|UNION ALL|UNION)\s+/gi, "\n$1\n  ")
    .replace(/\s+(GROUP BY|ORDER BY)\s+/gi, "\n$1\n  ")
    .replace(/\s+(LEFT JOIN|RIGHT JOIN|INNER JOIN|FULL JOIN|CROSS JOIN|JOIN)\s+/gi, "\n$1 ");
}

function SQL({ sql, queries, repaired, attempts }) {
  const [open, setOpen] = useState(true);
  const executedQueries = Array.isArray(queries) && queries.length ? queries : [sql];

  return (
    <section className="details">
      <button
        type="button"
        className="details-toggle"
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          <Activity size={17} />
          Executed SQL {executedQueries.length > 1 ? `queries (${executedQueries.length})` : "query"}
          {repaired ? ` · repaired in ${attempts} attempts` : ""}
        </span>
        <ChevronDown size={17} className={open ? "rot" : ""} />
      </button>

      {open && executedQueries.map((query, index) => (
        <div key={`${index}-${query}`}>
          {executedQueries.length > 1 && <div className="result-meta">Attempt {index + 1}</div>}
          <pre>{formatSqlForDisplay(query)}</pre>
        </div>
      ))}
    </section>
  );
}

function QueryResult({ result }) {
  const [open, setOpen] = useState(true);

  if (!result || !Array.isArray(result.columns) || !result.columns.length) {
    return null;
  }

  const columns = result.columns.map((column) =>
    typeof column === "object" ? column.name : String(column)
  );
  const rows = Array.isArray(result.rows) ? result.rows : [];

  return (
    <section className="details query-result">
      <button type="button" className="details-toggle" onClick={() => setOpen(!open)}>
        <span>
          <Database size={17} />
          Actual query result
          <em>{Number(result.row_count || rows.length).toLocaleString()} rows</em>
        </span>
        <ChevronDown size={17} className={open ? "rot" : ""} />
      </button>

      {open && (
        <div className="result-wrap">
          <div className="result-meta">
            Executed by DuckDB · {result.truncated ? "Showing first 1,000 rows" : "Complete result"}
          </div>

          <div className="result-table-scroll">
            <table>
              <thead>
                <tr>
                  {columns.map((column) => <th key={column}>{column}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    {columns.map((column) => (
                      <td key={`${index}-${column}`}>
                        {row?.[column] === null || row?.[column] === undefined
                          ? "—"
                          : typeof row[column] === "object"
                            ? JSON.stringify(row[column])
                            : String(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export default function App() {
  const [dataset, setDataset] = useState(null);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [visualizationType, setVisualizationType] = useState("all");
  const [showVisualizations, setShowVisualizations] = useState(true);
  const [activeSection, setActiveSection] = useState("overview");
  const [activePanel, setActivePanel] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [analysisHistory, setAnalysisHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("querymind-analysis-history")) || []; } catch { return []; }
  });
  const fileInputRef = useRef(null);
  const questionInputRef = useRef(null);
  const overviewRef = useRef(null);
  const sourcesRef = useRef(null);
  const visualizationsRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/api/dataset`)
      .then((response) => response.json())
      .then((data) => {
        if (data?.loaded) setDataset(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem("querymind-analysis-history", JSON.stringify(analysisHistory));
  }, [analysisHistory]);

  const upload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setError("");
    setMessage("Uploading and inspecting your dataset...");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${API}/api/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.detail || "Upload failed");
      }

      setDataset(data);
      setResult(null);
      setMessage(
        `Loaded ${data.filename} • ${Number(data.rows).toLocaleString()} rows • ${data.columns} columns`
      );
    } catch (uploadError) {
      setError(uploadError?.message || "Upload failed");
      setMessage("");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };

  const removeDataset = async () => {
    if (!dataset || !window.confirm("Remove this dataset and its local analysis database?")) return;

    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API}/api/dataset`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data?.removed) throw new Error(data?.detail || "Could not remove the dataset.");
      setDataset(null);
      setResult(null);
      setQuestion("");
      setMessage("Dataset removed. You can ask a general question or upload a new file.");
    } catch (removeError) {
      setError(removeError?.message || "Could not remove the dataset.");
    } finally {
      setBusy(false);
    }
  };

  const ask = async (text) => {
    const currentQuestion = String(text ?? question).trim();
    const includeVisualizations = showVisualizations;

    if (!currentQuestion) return;

    setBusy(true);
    setError("");
    setMessage(dataset ? "Generating SQL, executing it, and building visualizations..." : "A dataset is required for analysis...");

    try {
      const response = await fetch(`${API}/api/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: currentQuestion,
          visualization_type: visualizationType,
          include_visualizations: includeVisualizations,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.detail || "Analysis failed");
      }

      setResult({
        ...data,
        visualizations_enabled: data.general ? false : includeVisualizations,
      });
      setAnalysisHistory((previous) => [
        { question: currentQuestion, visualizationType, showVisualizations, savedAt: Date.now() },
        ...previous.filter((item) => item.question !== currentQuestion),
      ].slice(0, 12));
      setQuestion("");
      setMessage(data.general ? "General answer ready." : "Analysis complete — choose a visualization or view all compatible charts.");
    } catch (analysisError) {
      setError(analysisError?.message || "Analysis failed");
      setMessage("");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setQuestion("");
    setError("");
    setMessage("Ready for a new analysis.");
  };

  const startNewAnalysis = () => {
    reset();
    setActivePanel(null);
    window.setTimeout(() => {
      questionInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      questionInputRef.current?.focus();
    }, 0);
  };

  const navigateTo = (section) => {
    const sectionRefs = { overview: overviewRef, sources: sourcesRef, visualizations: visualizationsRef };
    setActiveSection(section);
    sectionRefs[section]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const exportResult = () => {
    const queryResult = result?.query_result;
    if (!queryResult?.columns?.length || !Array.isArray(queryResult.rows)) {
      setError("Run an analysis before exporting results.");
      return;
    }

    const columns = queryResult.columns.map((column) =>
      typeof column === "object" ? column.name : String(column)
    );
    const csvValue = (value) => {
      const text = value === null || value === undefined
        ? ""
        : typeof value === "object" ? JSON.stringify(value) : String(value);
      return `"${text.replaceAll('"', '""')}"`;
    };
    const csv = [columns.map(csvValue).join(","), ...queryResult.rows.map((row) =>
      columns.map((column) => csvValue(row?.[column])).join(",")
    )].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `${(dataset?.filename || "querymind-results").replace(/\.[^/.]+$/, "")}-analysis.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    setMessage("Analysis results exported as CSV.");
  };

  const submitSearch = () => {
    const search = searchText.trim();
    if (!search) return;
    setActivePanel(null);
    setSearchText("");
    ask(search);
  };

  return (
    <div className="app">
      <Sidebar
        onNew={startNewAnalysis}
        onSettings={() => setActivePanel("settings")}
        onHistory={() => setActivePanel("history")}
        activeSection={activeSection}
        onNavigate={navigateTo}
      />

      <main className="main">
        <Topbar
          dataset={dataset}
          onSearch={() => setActivePanel("search")}
          onExport={exportResult}
        />

        <div className="workspace" ref={overviewRef}>
          <section className="upload-hero" ref={sourcesRef}>
            <div>
              <div className="eyebrow">DATA SOURCE</div>
              <h2>Bring your own data</h2>
              <p>
                Upload any structured data file. QUERYMIND detects its format, creates a DuckDB table,
                and lets you ask questions in plain English.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="*/*"
              hidden
              onChange={upload}
            />

            <button
              type="button"
              className="upload-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              <Upload size={17} />
              {dataset ? "Replace dataset" : "Upload dataset"}
            </button>
          </section>

          {dataset && (
            <section className="dataset-strip">
              <FileSpreadsheet size={18} />
              <div>
                <b>{dataset.filename || "Dataset loaded"}</b>
                <span>
                  {Number(dataset.rows || 0).toLocaleString()} rows · {dataset.columns || 0} columns
                </span>
              </div>
              <button className="remove-dataset" type="button" onClick={removeDataset} disabled={busy}>
                <Trash2 size={15} /> Remove
              </button>
            </section>
          )}

          {dataset?.dataset_questions?.length > 0 && (
            <section className="dataset-questions" aria-labelledby="dataset-questions-title">
              <div className="eyebrow">DATASET QUESTION LIBRARY</div>
              <h3 id="dataset-questions-title">Explore questions for your dataset</h3>
              <p>These questions are generated from your uploaded columns. Select one to run it, or use it as a starting point.</p>
              <div className="dataset-question-grid">
                {dataset.dataset_questions.map((item) => (
                  <button key={item} type="button" onClick={() => ask(item)} disabled={busy}>
                    <Sparkles size={14} />
                    <span>{item}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="visual-choice-panel" ref={visualizationsRef}>
            <div>
              <div className="eyebrow">VISUALIZATION MODE</div>
              <h3>Choose how QUERYMIND should visualize your answer</h3>
              <p>
                “All compatible” shows every chart that can be derived safely from the actual query result.
              </p>
            </div>

            <label className="visual-toggle">
              <input type="checkbox" checked={showVisualizations} onChange={(event) => setShowVisualizations(event.target.checked)} />
              <span className="toggle-track"><span /></span>
              <b>Dynamic visualizations {showVisualizations ? "on" : "off"}</b>
            </label>

            {showVisualizations && <div className="visual-option-grid">
              {VISUAL_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = visualizationType === option.key;

                return (
                  <button
                    type="button"
                    key={option.key}
                    className={`visual-option ${selected ? "selected" : ""}`}
                    onClick={() => setVisualizationType(option.key)}
                  >
                    <Icon size={15} />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>}
          </section>

          {result && (
            <>
              <div className="conversation-label">
                <span className="user-dot">U</span>
                {result.question}
              </div>

              <section className="answer">
                <div className="ai-badge">
                  <Sparkles size={15} /> AI ANALYSIS
                </div>
                <h2>Analysis complete</h2>
                <p>{result.answer}</p>
              </section>

              {!result.general && result.metrics?.length > 0 && (
                <div className="metrics">
                  {result.metrics.map((metric, index) => (
                    <Metric
                      key={`${metric.label || "metric"}-${index}`}
                      item={metric}
                      index={index}
                    />
                  ))}
                </div>
              )}

              {!result.general && showVisualizations && <>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">VISUAL ANALYSIS</span>
                  <h2>
                    {visualizationType === "all"
                      ? "Explore all compatible views"
                      : visualizationType === "auto"
                        ? "Recommended view for your question"
                      : `Explore the ${visualizationType.replace("_", " ")} view`}
                  </h2>
                </div>
                <button type="button" className="view-btn">
                  <Activity size={16} /> DuckDB result
                </button>
              </div>

              <VisualizationStudio
                result={result.query_result}
                selectedType={visualizationType}
                preferredType={result.chart_hint}
              />

              <section className="insight">
                <div className="insight-icon">
                  <Sparkles size={18} />
                </div>
                <div>
                  <div className="insight-label">AI INSIGHT</div>
                  <h3>What the analysis found</h3>
                  <p>{result.insight}</p>
                </div>
              </section>

              </>}

              {!result.general && <>
                <SQL
                  sql={result.sql}
                  queries={result.executed_sql}
                  repaired={result.sql_repaired}
                  attempts={result.sql_attempts}
                />

                <QueryResult result={result.query_result} />
              </>}

              {result.suggested_questions?.length > 0 && (
                <section className="followups">
                  <div className="eyebrow">CONTINUE ANALYSIS</div>
                  <div className="followup-row">
                    {result.suggested_questions.map((item) => (
                      <button
                        type="button"
                        key={item}
                        onClick={() => ask(item)}
                        disabled={busy}
                      >
                        <Sparkles size={14} />
                        {item}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          {!result && (
            <section className="answer">
              <div className="ai-badge">
                <Sparkles size={15} /> READY
              </div>
              <h2>
                {dataset
                  ? "Your data is ready."
                  : "Upload a dataset to begin."}
              </h2>
              <p>
                {dataset
                  ? "Choose a visualization mode, then ask a natural-language question."
                  : "QUERYMIND only answers questions related to your uploaded dataset."}
              </p>
            </section>
          )}

          {message && (
            <div className="sent-note">
              <Sparkles size={15} /> {message}
            </div>
          )}

          {error && (
            <div className="sent-note error">
              <X size={16} /> {error}
            </div>
          )}

          <div className="ask-box">
            <div className="ask-icon">
              <Sparkles size={18} />
            </div>

            <input
              ref={questionInputRef}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  ask();
                }
              }}
              placeholder={
                dataset
                  ? "Ask anything about your data..."
                  : "Upload a dataset first..."
              }
              disabled={busy}
            />

            <button
              type="button"
              className="send"
              onClick={() => ask()}
              disabled={busy || !dataset || !question.trim()}
            >
              <Send size={17} />
            </button>
          </div>
        </div>
      </main>

      {activePanel === "search" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setActivePanel(null)}>
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="search-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setActivePanel(null)} aria-label="Close search"><X size={18} /></button>
            <div className="eyebrow">QUERYMIND SEARCH</div>
            <h2 id="search-title">Ask your data a question</h2>
            <p>Search uses QUERYMIND’s data analysis engine to find the answer in your uploaded dataset.</p>
            <form className="modal-search" onSubmit={(event) => { event.preventDefault(); submitSearch(); }}>
              <Search size={18} />
              <input autoFocus value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={dataset ? "e.g. What changed this month?" : "Upload a dataset first"} disabled={!dataset || busy} />
              <button type="submit" disabled={!dataset || busy || !searchText.trim()}>Search</button>
            </form>
          </section>
        </div>
      )}

      {activePanel === "settings" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setActivePanel(null)}>
          <section className="modal-panel settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setActivePanel(null)} aria-label="Close settings"><X size={18} /></button>
            <div className="eyebrow">SETTINGS</div>
            <h2 id="settings-title">Analysis preferences</h2>
            <p>Choose the visualization QUERYMIND should use for your next question.</p>
            <label className="settings-field">
              <span>Default visualization</span>
              <select value={visualizationType} onChange={(event) => setVisualizationType(event.target.value)}>
                {VISUAL_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </label>
            <button className="modal-primary" type="button" onClick={() => { setActivePanel(null); setMessage("Analysis preferences saved."); }}>Save preferences</button>
          </section>
        </div>
      )}

      {activePanel === "history" && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setActivePanel(null)}>
          <section className="modal-panel history-panel" role="dialog" aria-modal="true" aria-labelledby="history-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setActivePanel(null)} aria-label="Close analysis history"><X size={18} /></button>
            <div className="eyebrow">ANALYSIS HISTORY</div>
            <h2 id="history-title">Recent questions</h2>
            <p>Saved on this device. Select a question to run it again against the current dataset.</p>
            {analysisHistory.length ? (
              <div className="history-list">
                {analysisHistory.map((item) => (
                  <button key={`${item.question}-${item.savedAt}`} type="button" onClick={() => { setVisualizationType(item.visualizationType || "all"); setShowVisualizations(item.showVisualizations !== false); setActivePanel(null); ask(item.question); }} disabled={busy}>
                    <History size={15} />
                    <span>{item.question}</span>
                    <em>{new Date(item.savedAt).toLocaleDateString()}</em>
                  </button>
                ))}
              </div>
            ) : <div className="history-empty">Your completed analyses will appear here.</div>}
            {analysisHistory.length > 0 && <button className="history-clear" type="button" onClick={() => setAnalysisHistory([])}>Clear history</button>}
          </section>
        </div>
      )}
    </div>
  );
}
