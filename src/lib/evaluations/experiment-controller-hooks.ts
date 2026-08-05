import { createContext, useContext } from "react";
import type { ExecutionLease } from "../execution-lease";
import type { ExperimentController } from "./experiment-controller";

export interface ExperimentControllerContextValue {
  controller: ExperimentController | null;
  /** The tab's cross-tab execution lease, shared with the controller. */
  lease: ExecutionLease | null;
}

export const ExperimentControllerContext = createContext<ExperimentControllerContextValue>({
  controller: null,
  lease: null,
});

export function useExperimentController(): ExperimentController | null {
  return useContext(ExperimentControllerContext).controller;
}

export function useExecutionLease(): ExecutionLease | null {
  return useContext(ExperimentControllerContext).lease;
}
