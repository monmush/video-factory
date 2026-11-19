import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./lib/api";
import { loadOnboarded } from "./lib/claude-setup";
import { refreshWorkspace } from "./lib/workspace";
import { router } from "./router";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

document.documentElement.dataset.platform = api.platform;

await Promise.all([refreshWorkspace(), loadOnboarded()]);

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
