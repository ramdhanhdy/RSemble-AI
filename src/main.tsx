import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import RSemble from "./rsemble";
import { RepositoryProvider } from "./lib/persistence/repository-context";
import { ExecutionOwnerProvider } from "./lib/execution-owner-context";
import { ExperimentControllerProvider } from "./lib/evaluations/experiment-controller-context";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <RepositoryProvider>
        <ExecutionOwnerProvider>
          <ExperimentControllerProvider>
            <RSemble />
          </ExperimentControllerProvider>
        </ExecutionOwnerProvider>
      </RepositoryProvider>
    </HashRouter>
  </React.StrictMode>,
);
