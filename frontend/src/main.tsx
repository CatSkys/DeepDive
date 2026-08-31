import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initTitlebarBridge } from "./titlebar";

initTitlebarBridge();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
