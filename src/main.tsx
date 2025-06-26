import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import { Prog } from "./Prog.js";
import { Root } from "./Root.js";
import { Test } from "./Test.js";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<Root />} />
        <Route path="/prog" element={<Prog />} />
        <Route path="/test" element={<Test />} />
      </Routes>
    </HashRouter>
  </React.StrictMode>,
);
