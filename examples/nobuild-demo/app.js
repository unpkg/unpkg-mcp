import { h, render } from "preact";
import { useState } from "preact/hooks";
import { html } from "htm/preact";
import clsx from "clsx";
import confetti from "canvas-confetti";

function App() {
  const [count, setCount] = useState(0);
  const celebrate = () => {
    setCount(count + 1);
    confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
  };
  return html`
    <div>
      <p class=${clsx("count", count > 0 && "has-count")}>Count: ${count}</p>
      <button onClick=${celebrate}>Increment + confetti</button>
      <button onClick=${() => setCount(0)}>Reset</button>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById("app"));
