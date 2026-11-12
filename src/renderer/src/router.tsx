import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { AppShell } from "./components/app-shell";
import { AssetsPage } from "./screens/assets";
import { HomePage } from "./screens/home";
import { NotFound } from "./screens/not-found";
import { SeriesPage } from "./screens/series";
import { SeriesNewPage } from "./screens/series-new";
import { ScriptsPage, SessionLayout, VideosPage } from "./screens/session";
import { SettingsPage } from "./screens/settings";

// Code-based routes: few enough that a generated route tree is not worth the plugin.
// Hash history works for both the dev server and the packaged file:// load.

const rootRoute = createRootRoute({ component: AppShell, notFoundComponent: NotFound });

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: HomePage });

const seriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/series/$seriesId",
  component: SeriesPage,
});

const seriesNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/series/new",
  component: SeriesNewPage,
});

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions/$sessionId",
  component: SessionLayout,
});

const sessionIndexRoute = createRoute({
  getParentRoute: () => sessionRoute,
  path: "/",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/sessions/$sessionId/scripts", params });
  },
});

const scriptsRoute = createRoute({
  getParentRoute: () => sessionRoute,
  path: "scripts",
  component: ScriptsPage,
});

const videosRoute = createRoute({
  getParentRoute: () => sessionRoute,
  path: "videos",
  component: VideosPage,
});

const assetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assets",
  component: AssetsPage,
});

const assetsCategoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assets/$category",
  component: AssetsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  seriesNewRoute,
  seriesRoute,
  sessionRoute.addChildren([sessionIndexRoute, scriptsRoute, videosRoute]),
  assetsRoute,
  assetsCategoryRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
