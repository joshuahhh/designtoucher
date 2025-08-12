import "@radix-ui/themes/styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Amplify } from "./Amplify.js";
import { App } from "./App.js";
import "./index.css";
import { Sender } from "./Sender.js";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/amplify" element={<Amplify />} />
        <Route path="/sender/:id" element={<Sender />} />
      </Routes>
    </HashRouter>
  </React.StrictMode>,
);
