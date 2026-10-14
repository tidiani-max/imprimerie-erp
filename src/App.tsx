import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import ProtectedRoute from "./auth/ProtectedRoute";
import AppShell from "./layout/AppShell";
import AccountPage from "./pages/Account";
import SettingsPage from "./pages/Settings";
import CashPage from "./pages/Cash";
import ClientsPage from "./pages/Clients";
import DashboardPage from "./pages/Dashboard";
import ExpensesPage from "./pages/Expenses";
import ForgotPassword from "./pages/ForgotPassword";
import Login from "./pages/Login";
import OrdersPage from "./pages/Orders";
import Signup from "./pages/Signup";
import StockPage from "./pages/Stock";

export default function App() {
  return <AuthProvider>
    <Routes>
      <Route path="/login" element={<Login/>}/>
      <Route path="/signup" element={<Signup/>}/>
      <Route path="/forgot-password" element={<ForgotPassword/>}/>
      <Route element={<ProtectedRoute><AppShell/></ProtectedRoute>}>
        <Route index element={<DashboardPage/>}/>
        <Route path="orders" element={<OrdersPage/>}/>
        <Route path="clients" element={<ClientsPage/>}/>
        <Route path="stock" element={<StockPage/>}/>
        <Route path="expenses" element={<ExpensesPage/>}/>
        <Route path="cash" element={<CashPage/>}/>
        <Route path="account" element={<AccountPage/>}/>
        <Route path="settings" element={<SettingsPage/>}/>
        <Route path="*" element={<DashboardPage/>}/>
      </Route>
    </Routes>
  </AuthProvider>;
}
