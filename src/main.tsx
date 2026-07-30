import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import RSemble from "./rsemble";
import { RepositoryProvider } from "./lib/persistence/repository-context";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <RepositoryProvider>
        <RSemble />
      </RepositoryProvider>
    </HashRouter>
  </React.StrictMode>,
);
