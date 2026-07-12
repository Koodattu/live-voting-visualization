import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router";
import { ErrorState, PageShell } from "./components/ui.js";
import { AdminPage } from "./pages/AdminPage.js";
import { DisplayPage } from "./pages/DisplayPage.js";
import { HomePage } from "./pages/HomePage.js";
import { ParticipantPage } from "./pages/ParticipantPage.js";
import "./styles.css";

function NotFoundPage() {
  return (
    <PageShell>
      <ErrorState
        message="That page or Voting Session does not exist."
        action={
          <Link className="button button--secondary" to="/">
            Back to live sessions
          </Link>
        }
      />
    </PageShell>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing.");

createRoot(root).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/:joinName/display" element={<DisplayPage />} />
      <Route path="/:joinName" element={<ParticipantPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  </BrowserRouter>,
);
