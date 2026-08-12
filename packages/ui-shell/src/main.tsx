import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Bootstrap } from "./bootstrap.js";
import "./theme.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>,
);
