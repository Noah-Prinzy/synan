import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "../data/auth";

export function RequireSession({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const location = useLocation();

  if (!session) {
    return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  return <>{children}</>;
}
