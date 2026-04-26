import React from "react";
import { Outlet, Link, useLocation } from "react-router";
import { Search, Menu } from "lucide-react";
import { newSessionId, getOrCreateUserId } from "../analytics/session";
import { startTracker } from "../analytics/tracker";
import { AnalyticsPanel } from "./AnalyticsPanel";

export function Layout() {
  const location = useLocation();
  const sessionId = React.useMemo(() => newSessionId(), []);
  const userId = React.useMemo(() => getOrCreateUserId(), []);
  const trackerRef = React.useRef<ReturnType<typeof startTracker> | null>(null);

  React.useEffect(() => {
    trackerRef.current = startTracker({
      sessionId,
      userId,
      getPathname: () => window.location.pathname,
    });
    return () => trackerRef.current?.stop();
  }, [sessionId, userId]);

  React.useEffect(() => {
    trackerRef.current?.trackNav(location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background pr-[340px] sm:pr-[360px] lg:pr-[400px] xl:pr-[420px]">
      <AnalyticsPanel sessionId={sessionId} userId={userId} />
      <header className="bg-secondary text-secondary-foreground shadow-sm">
        <div className="border-b border-white/10">
          <div className="max-w-7xl mx-auto px-6 py-3" data-section-id="header">
            <div className="flex items-center justify-between">
              <Link to="/" className="hover:opacity-90" data-track="nav_home_logo">
                <div className="flex items-center gap-3">
                  <div className="text-2xl tracking-tight">STATE UNIVERSITY</div>
                </div>
              </Link>
              <div className="flex items-center gap-4">
                <Search className="w-5 h-5 cursor-pointer hover:text-accent" data-track="header_search_icon" />
                <button className="p-2 hover:bg-white/10 rounded" data-track="header_menu_button">
                  <Menu className="w-6 h-6" />
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-primary">
          <nav className="max-w-7xl mx-auto px-6">
            <div className="flex gap-8 text-sm">
              <Link to="/" data-track="nav_home" className="py-4 hover:bg-white/10 px-3 transition-colors border-b-2 border-transparent hover:border-accent">Home</Link>
              <Link to="/admissions" data-track="nav_admissions" className="py-4 hover:bg-white/10 px-3 transition-colors border-b-2 border-transparent hover:border-accent">Admissions</Link>
              <Link to="/courses" data-track="nav_courses" className="py-4 hover:bg-white/10 px-3 transition-colors border-b-2 border-transparent hover:border-accent">Academics</Link>
              <Link to="/financial-aid" data-track="nav_financial_aid" className="py-4 hover:bg-white/10 px-3 transition-colors border-b-2 border-transparent hover:border-accent">Financial Aid</Link>
              <Link to="/housing" data-track="nav_housing" className="py-4 hover:bg-white/10 px-3 transition-colors border-b-2 border-transparent hover:border-accent">Campus Life</Link>
            </div>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10" data-section-id="main">
        <Outlet />
      </main>

      <footer className="bg-secondary text-secondary-foreground mt-20 py-12">
        <div className="max-w-7xl mx-auto px-6" data-section-id="footer">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10 text-sm">
            <div>
              <h3 className="mb-4 text-accent">Quick Links</h3>
              <ul className="space-y-2.5 text-secondary-foreground/90">
                <li><a href="#" data-track="footer_directory" className="hover:text-accent transition-colors">Directory</a></li>
                <li><a href="#" data-track="footer_campus_map" className="hover:text-accent transition-colors">Campus Map</a></li>
                <li><a href="#" data-track="footer_libraries" className="hover:text-accent transition-colors">Libraries</a></li>
              </ul>
            </div>
            <div>
              <h3 className="mb-4 text-accent">Resources</h3>
              <ul className="space-y-2.5 text-secondary-foreground/90">
                <li><a href="#" data-track="footer_it_help" className="hover:text-accent transition-colors">IT Help</a></li>
                <li><a href="#" data-track="footer_student_services" className="hover:text-accent transition-colors">Student Services</a></li>
                <li><a href="#" data-track="footer_health_center" className="hover:text-accent transition-colors">Health Center</a></li>
              </ul>
            </div>
            <div>
              <h3 className="mb-4 text-accent">Support</h3>
              <ul className="space-y-2.5 text-secondary-foreground/90">
                <li><a href="#" data-track="footer_contact" className="hover:text-accent transition-colors">Contact Us</a></li>
                <li><a href="#" data-track="footer_faqs" className="hover:text-accent transition-colors">FAQs</a></li>
                <li><a href="#" data-track="footer_accessibility" className="hover:text-accent transition-colors">Accessibility</a></li>
              </ul>
            </div>
            <div>
              <h3 className="mb-4 text-accent">About</h3>
              <ul className="space-y-2.5 text-secondary-foreground/90">
                <li><a href="#" data-track="footer_about" className="hover:text-accent transition-colors">About SU</a></li>
                <li><a href="#" data-track="footer_privacy" className="hover:text-accent transition-colors">Privacy Policy</a></li>
                <li><a href="#" data-track="footer_terms" className="hover:text-accent transition-colors">Terms of Use</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-10 pt-8 border-t border-white/10 text-center text-secondary-foreground/70 text-sm">
            © 2026 State University. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
