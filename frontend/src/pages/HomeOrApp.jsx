import React from "react";
import PricingPage from "./PricingPage";

/** After install, `/` is always the public website (WordPress-style). ERP lives at `/panel`. */
export default function HomeOrApp() {
  return <PricingPage />;
}
