import React from "react";
import ReactDOM from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import "@/api/client";
import "@/index.css";
import App from "@/App";
import { canonicalizeLocalOrigin } from "@/canonicalizeLocal";

canonicalizeLocalOrigin();
// React 19 + react-helmet-async 3 data-rh kaldırmıyor; bot meta’sını JS ortamında sil.
document.querySelectorAll('head [data-rh="true"]:not(title)').forEach((n) => n.remove());

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </React.StrictMode>,
);
