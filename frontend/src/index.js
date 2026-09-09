import React from "react";
import ReactDOM from "react-dom/client";
import "@/api/client";
import "@/index.css";
import App from "@/App";

import axios from "axios";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { canonicalizeLocalOrigin } from "@/canonicalizeLocal";
import "@/index.css";
import App from "@/App";

canonicalizeLocalOrigin();
axios.defaults.withCredentials = true;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
