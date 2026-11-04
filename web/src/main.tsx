import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import App from "./App";
import { Skeleton } from "./components/ui";
import NotFound, { RouteError } from "./pages/NotFound";

// Every page is lazy: the initial chunk carries only the shell, and recharts (the bundle's
// main weight) loads with the first page that actually draws a chart.
const Home = lazy(() => import("./pages/Home"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Clients = lazy(() => import("./pages/Clients"));
const ClientDetail = lazy(() => import("./pages/ClientDetail"));
const Audit = lazy(() => import("./pages/Audit"));
const Review = lazy(() => import("./pages/Review"));
const Onboard = lazy(() => import("./pages/Onboard"));
const Ads = lazy(() => import("./pages/Ads"));
const Social = lazy(() => import("./pages/Social"));
const Monitor = lazy(() => import("./pages/Monitor"));
const MailAudit = lazy(() => import("./pages/MailAudit"));
const MarketGaps = lazy(() => import("./pages/MarketGaps"));
const Research = lazy(() => import("./pages/Research"));

function PageFallback() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <Skeleton className="h-8 w-52" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

const wrap = (el: React.ReactNode) => <Suspense fallback={<PageFallback />}>{el}</Suspense>;

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: wrap(<Home />) },
      { path: "dashboard", element: wrap(<Dashboard />) },
      { path: "clients", element: wrap(<Clients />) },
      { path: "clients/:slug", element: wrap(<ClientDetail />) },
      { path: "audit/:jobId", element: wrap(<Audit />) },
      { path: "audit/:jobId/review", element: wrap(<Review />) },
      { path: "onboard", element: wrap(<Onboard />) },
      { path: "ads", element: wrap(<Ads />) },
      { path: "social", element: wrap(<Social />) },
      { path: "market-gaps", element: wrap(<MarketGaps />) },
      { path: "research", element: wrap(<Research />) },
      { path: "mail-audit", element: wrap(<MailAudit />) },
      { path: "monitor", element: wrap(<Monitor />) },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
