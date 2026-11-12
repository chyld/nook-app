// The browser entry: the layers and tokens, the bundled fonts, and the app.
import "./styles/base.css";
import "./styles/tokens.css";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/bricolage-grotesque";
import { mount } from "svelte";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });
