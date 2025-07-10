import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Amplify } from "./Amplify.js";
import "./index.css";
import { Prog } from "./Prog.js";
import { Root } from "./Root.js";
import { Test } from "./Test.js";
import { Test2 } from "./Test2.js";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<Root />} />
        <Route path="/prog" element={<Prog />} />
        <Route path="/test" element={<Test />} />
        <Route path="/test2" element={<Test2 />} />
        <Route path="/amplify" element={<Amplify />} />
      </Routes>
    </HashRouter>
  </React.StrictMode>,
);
