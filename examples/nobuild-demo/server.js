// Stub only — this is what the express dependency in package.json is for.
// The demo page does not need a server beyond a static file server; this
// file exists so the dependency map contains one clear "do not convert"
// server package for the audit to reject.
import express from "express";

const app = express();
app.use(express.static("."));
app.listen(5173, () => console.log("demo on http://localhost:5173"));
