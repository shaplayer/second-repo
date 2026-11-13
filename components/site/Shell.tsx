import { Footer } from "./Footer";
import { Header } from "./Header";

/** The frame around every page: mint glow, header, the page itself, footer. */
export function Shell({ children, search = true }: { children: React.ReactNode; search?: boolean }) {
  return (
    <div className="page flex flex-col">
      <Header search={search} />
      <main id="main" className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
