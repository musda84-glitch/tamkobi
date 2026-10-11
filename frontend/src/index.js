import React from "react";
import ReactDOM from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import "@/api/client";
import "@/index.css";
import App from "@/App";
import { canonicalizeLocalOrigin } from "@/canonicalizeLocal";

canonicalizeLocalOrigin();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </React.StrictMode>,
);
