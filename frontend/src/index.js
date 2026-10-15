import React from "react";
import ReactDOM from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import "@/api/client";
import "@/index.css";
import "@/theme/ynt.css";
import App from "@/App";
import { canonicalizeLocalOrigin } from "@/canonicalizeLocal";
import { stripStaticRhTags } from "@/stripStaticRhTags";
import { installPrintPageCss } from "@/utils/printPageCss";

canonicalizeLocalOrigin();
installPrintPageCss();
// Bot meta index.html’de kalsın; JS ortamında çift etiket olmasın.
stripStaticRhTags();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </React.StrictMode>,
);
