import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import AccessDenied from "../components/common/AccessDenied";

export default function ProtectedRoute({ children, permission }: { children: ReactNode; permission?: string }) {
  const { user, can } = useAuth();
  const location = useLocation();
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (permission && !can(permission)) {
    return <AccessDenied />;
  }
  return <>{children}</>;
}
