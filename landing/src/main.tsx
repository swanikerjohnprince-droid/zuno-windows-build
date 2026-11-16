import React from "react";
import ReactDOM from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { App } from "./App";
import "./styles.css";

/*
 * Dark, always.
 *
 * The site ships one theme, so this is set once here rather than read from a preference. The
 * token layer still keys off `data-theme`, which keeps the light values one attribute away if
 * that ever changes.
 */
document.documentElement.dataset.theme = "dark";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
    <Analytics />
  </React.StrictMode>,
);
