import { Route, Routes } from "react-router-dom"

import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import FeatureRequestFormPage from "@/pages/FeatureRequestFormPage"
import LoginPage from "@/pages/LoginPage"
import MainPage from "@/pages/MainPage"
import ProjectFormPage from "@/pages/ProjectFormPage"
import ProjectPage from "@/pages/ProjectPage"
import RegisterPage from "@/pages/RegisterPage"

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/new"
        element={
          <ProtectedRoute>
            <ProjectFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:id/edit"
        element={
          <ProtectedRoute>
            <ProjectFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:id"
        element={
          <ProtectedRoute>
            <ProjectPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:projectId/feature-requests/new"
        element={
          <ProtectedRoute>
            <FeatureRequestFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/feature-requests/:id/edit"
        element={
          <ProtectedRoute>
            <FeatureRequestFormPage />
          </ProtectedRoute>
        }
      />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
    </Routes>
  )
}
