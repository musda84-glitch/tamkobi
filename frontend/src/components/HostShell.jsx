import React from "react";
import MainLayout from "./MainLayout";
import IkLayout from "./IkLayout";
import { getHostKind } from "../utils/hosts";

/** Picks ERP MainLayout, IK shell, or passthrough (b2b / bare public). */
export default function HostShell({ children }) {
  const kind = getHostKind();
  if (kind === "ik") {
    return <IkLayout>{children}</IkLayout>;
  }
  if (kind === "b2b") {
    return <>{children}</>;
  }
  // site + app share MainLayout (site hides ERP chrome on public paths)
  return <MainLayout>{children}</MainLayout>;
}
