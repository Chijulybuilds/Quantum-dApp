import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import { Nav } from "./components/Nav";
import { Preloader } from "./components/Preloader";
import { SmoothScroll } from "./components/SmoothScroll";
import { ScrollTrigger } from "./lib/motion";
import { AppPage } from "./pages/AppPage";
import { Cover } from "./pages/Cover";
import { Landing } from "./pages/Landing";

function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    // Layout changed: let ScrollTrigger recompute positions.
    const t = setTimeout(() => ScrollTrigger.refresh(), 300);
    return () => clearTimeout(t);
  }, [pathname]);
  return null;
}

export function App() {
  const { pathname } = useLocation();
  // The cover is a bare 1920×1080 frame for the project page image.
  if (pathname === "/cover") return <Cover />;
  return (
    <>
      <Preloader />
      <SmoothScroll />
      <ScrollReset />
      <Nav />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<AppPage />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </>
  );
}
