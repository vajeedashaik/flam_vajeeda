import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/theme.css";

// Theme bootstrap: honour a stored choice, else fall back to the system setting.
try {
  const stored = localStorage.getItem("ale-theme");
  if (stored === "dark" || stored === "light") {
    document.documentElement.setAttribute("data-theme", stored);
  }
} catch {
  /* private mode / blocked storage — system theme applies */
}

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error('Missing <div id="root"> in index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
