import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Amplify } from "./Amplify.js";
import { Flow } from "./Flow.js";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Theme appearance="light" className="w-full h-full">
      <HashRouter>
        <Routes>
          <Route path="/" element={<Flow />} />
          <Route path="/amplify" element={<Amplify />} />
        </Routes>
      </HashRouter>
    </Theme>
  </React.StrictMode>,
);
