import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import ProtectedRoute from "./auth/ProtectedRoute";
import { useAuth } from "./auth/AuthContext";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import DeviceInventoryPage from "./pages/DeviceInventoryPage";
import DeviceDetailsPage from "./pages/device-details/DeviceDetailsPage";
import DeviceManagementPage from "./pages/DeviceManagementPage";
import FirmwarePage from "./pages/firmware/FirmwarePage";
import DeploymentDetailsPage from "./pages/firmware/DeploymentDetailsPage";
import ApplicationsPage from "./pages/ApplicationsPage";
import ApplicationDetailsPage from "./pages/ApplicationDetailsPage";
import MonitoringPage from "./pages/MonitoringPage";
import DeviceDiagnosticsPage from "./pages/DeviceDiagnosticsPage";
import AlertsPage from "./pages/AlertsPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import UsersPage from "./pages/UsersPage";
import AuditLogsPage from "./pages/AuditLogsPage";
import SettingsPage from "./pages/SettingsPage";
import NotFoundPage from "./pages/NotFoundPage";

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/devices" element={<DeviceInventoryPage />} />
        <Route path="/devices/:deviceId" element={<DeviceDetailsPage />} />
        <Route path="/device-management" element={<DeviceManagementPage />} />
        <Route path="/firmware" element={<FirmwarePage />} />
        <Route path="/firmware/deployments/:code" element={<DeploymentDetailsPage />} />
        <Route path="/applications" element={<ApplicationsPage />} />
        <Route path="/applications/:appId" element={<ApplicationDetailsPage />} />
        <Route path="/monitoring" element={<MonitoringPage />} />
        <Route path="/monitoring/devices/:deviceId" element={<DeviceDiagnosticsPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route
          path="/users"
          element={
            <ProtectedRoute permission="users:manage">
              <UsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit-logs"
          element={
            <ProtectedRoute permission="audit:view">
              <AuditLogsPage />
            </ProtectedRoute>
          }
        />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
