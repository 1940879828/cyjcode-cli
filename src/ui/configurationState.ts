import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { hasConfig } from "../config/store.js";

export function useConfigurationState(): [
  boolean | null,
  Dispatch<SetStateAction<boolean | null>>,
] {
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    setConfigured(hasConfig());
  }, []);
  return [configured, setConfigured];
}
