import React from "react";
import ReactDOM from "react-dom/client";
import "@/api/client";
import "@/index.css";
import App from "@/App";
import { canonicalizeLocalOrigin } from "@/canonicalizeLocal";

const root = ReactDOM.createRoot(document.getElementById("root"));

Promise.resolve(canonicalizeLocalOrigin()).then((redirected) => {
  if (redirected) return;
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
