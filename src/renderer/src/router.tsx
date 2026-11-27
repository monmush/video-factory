import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { AppShell } from "./components/app-shell";
import { api } from "./lib/api";
import { AssetsPage } from "./screens/assets";
import { HomePage } from "./screens/home";
import { NotFound } from "./screens/not-found";
import { SeriesPage } from "./screens/series";
import { SeriesNewPage } from "./screens/series-new";
import { ScriptsPage, SessionLayout, StagingPage, VideosPage } from "./screens/session";
import { SettingsPage } from "./screens/settings";

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

const stagingRoute = createRoute({
  getParentRoute: () => sessionRoute,
  path: "staging",
  component: StagingPage,
});

const videosRoute = createRoute({
  getParentRoute: () => sessionRoute,
  path: "videos",
  component: VideosPage,
});

const retiredSessionSettingsRoute = createRoute({
  getParentRoute: () => sessionRoute,
  path: "settings",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/sessions/$sessionId/scripts", params });
  },
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
  sessionRoute.addChildren([
    sessionIndexRoute,
    scriptsRoute,
    stagingRoute,
    videosRoute,
    retiredSessionSettingsRoute,
  ]),
  assetsRoute,
  assetsCategoryRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree, history: createHashHistory() });

router.subscribe("onResolved", () => {
  const match = router.state.matches.at(-1);
  if (!match) return;
  void api
    .invoke("activity:screen", { route: match.fullPath, params: match.params })
    .catch(() => undefined);
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
