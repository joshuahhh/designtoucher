export * from "./Flow.js";
export * from "./initialFlow.js";
import "./index.css";

const USE_DEPLOYED_URL = false;
export const BASE_URL = USE_DEPLOYED_URL
  ? "https://joshuahhh.com/designtoucher/#"
  : window.location.href.replace(/#.*$/, "") + "#";
