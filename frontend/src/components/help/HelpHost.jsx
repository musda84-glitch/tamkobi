import React from "react";
import { PageTour } from "./PageTour";
import { OnboardingWizard } from "./OnboardingWizard";
import { useHelpOptional } from "../../context/HelpContext";

/** Global overlays: bubble tour + first-run wizard. */
export function HelpHost() {
  const help = useHelpOptional();
  if (!help) return null;
  return (
    <>
      <PageTour />
      <OnboardingWizard />
    </>
  );
}
