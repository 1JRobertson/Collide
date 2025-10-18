import { initAuth } from "./auth.js";
import { initProjection } from "./projection/index.js";
import { initEvents } from "./events/index.js";

initAuth();
initProjection();
initEvents();
