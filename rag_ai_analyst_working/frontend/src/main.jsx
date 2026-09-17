import React from "react";
import { createRoot } from "react-dom/client";
import "plotly.js/dist/plotly.min.js";
import "./styles.css";
import App from "./App";

createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
);