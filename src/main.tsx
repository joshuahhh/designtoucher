import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Amplify } from "./Amplify.js";
import { Flow } from "./Flow.js";
import "./index.css";
import { Prog } from "./Prog.js";
import { Root } from "./Root.js";
import { Test } from "./Test.js";
import { Test2 } from "./Test2.js";
import { Test3 } from "./Test3.js";
import { Test4 } from "./Test4.js";
import { Test5 } from "./Test5.js";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<Flow />} />
        <Route path="/prog" element={<Prog />} />
        <Route path="/root" element={<Root />} />
        <Route path="/test" element={<Test />} />
        <Route path="/test2" element={<Test2 />} />
        <Route path="/test3" element={<Test3 />} />
        <Route path="/test4" element={<Test4 />} />
        <Route path="/test5" element={<Test5 />} />
        <Route path="/amplify" element={<Amplify />} />
      </Routes>
    </HashRouter>
  </React.StrictMode>,
);
