import { Route, Routes } from "react-router-dom"

import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import LoginPage from "@/pages/LoginPage"
import MainPage from "@/pages/MainPage"
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
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
    </Routes>
  )
}
