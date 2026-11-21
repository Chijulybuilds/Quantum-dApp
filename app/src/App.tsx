import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import { Nav } from "./components/Nav";
import { Preloader } from "./components/Preloader";
import { ScrollTrigger } from "./lib/motion";
import { AppPage } from "./pages/AppPage";
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
  return (
    <>
      <Preloader />
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
